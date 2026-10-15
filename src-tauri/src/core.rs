use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::display::{self, ApplyError, DisplayMode, MonitorInfo};
use crate::i18n::{Locale, ThemeMode, format_mode, t, tr};
use crate::settings::{
    self, AppSettings, DefaultPreset, MAX_PROCESS_WATCH_INTERVAL_MS, MIN_PROCESS_WATCH_INTERVAL_MS,
    MonitorAlias, MonitorBinding, Preset,
};
use crate::vibrance;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub settings: AppSettings,
    pub monitors: Vec<MonitorInfo>,
    pub app_version: String,
    pub available_update: Option<AvailableUpdate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPresetResult {
    pub preset_id: String,
    pub preset_name: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppError {
    pub title: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInput {
    pub name: Option<String>,
    pub monitor_id: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub refresh_rate: Option<i64>,
    pub process_names: Option<Vec<String>>,
    pub vibrance: Option<i64>,
    pub is_default: Option<bool>,
}

pub struct ApplyOutcome {
    pub results: Vec<ApplyPresetResult>,
    pub refresh_error: Option<AppError>,
}

pub struct Core {
    pub settings: AppSettings,
    pub monitors: Vec<MonitorInfo>,
    pub available_update: Option<AvailableUpdate>,
    app_version: String,
    settings_path: PathBuf,
    /// Insertion-ordered: the most recently started process wins when presets share a monitor.
    active_process_presets: Vec<String>,
    /// Vibrance level each monitor had before a preset changed it, keyed by device name.
    vibrance_baselines: HashMap<String, vibrance::Snapshot>,
}

impl Core {
    pub fn new(settings_path: PathBuf, app_version: String) -> Self {
        Self {
            settings: settings::load(&settings_path),
            monitors: Vec::new(),
            available_update: None,
            app_version,
            settings_path,
            active_process_presets: Vec::new(),
            vibrance_baselines: HashMap::new(),
        }
    }

    pub fn locale(&self) -> Locale {
        self.settings.language
    }

    pub fn state(&self) -> AppState {
        AppState {
            settings: self.settings.clone(),
            monitors: self.monitors.clone(),
            app_version: self.app_version.clone(),
            available_update: self.available_update.clone(),
        }
    }

    fn save(&self) -> Result<(), String> {
        settings::save(&self.settings_path, &self.settings).map_err(|error| error.to_string())
    }

    pub fn refresh_monitors(&mut self) -> Result<(), AppError> {
        self.monitors = display::list_monitors();
        for monitor in &mut self.monitors {
            monitor.vibrance = vibrance::read(&monitor.device_name).map(|reading| reading.percent);
        }
        self.remember_monitor_bindings();
        self.migrate_legacy_preset_monitor_ids();
        self.save().map_err(|message| AppError {
            title: t(self.locale(), "error.refreshMonitorsFailed"),
            message,
        })
    }

    pub fn create_preset(&mut self, input: PresetInput) -> Result<(), String> {
        let is_default = input.is_default;
        let preset = self.build_preset(&input, None)?;
        let preset_id = preset.id.clone();
        self.settings.presets.push(preset);
        if is_default == Some(true) {
            self.set_default_preset(&preset_id)?;
        }
        self.save()
    }

    pub fn update_preset(&mut self, id: &str, input: PresetInput) -> Result<(), String> {
        let previous = self
            .settings
            .presets
            .iter()
            .find(|preset| preset.id == id)
            .cloned()
            .ok_or_else(|| t(self.locale(), "error.presetUpdateMissing"))?;

        let merged = PresetInput {
            name: input.name.or_else(|| Some(previous.name.clone())),
            monitor_id: input
                .monitor_id
                .or_else(|| Some(previous.monitor_id.clone())),
            width: input.width.or(Some(previous.width.into())),
            height: input.height.or(Some(previous.height.into())),
            refresh_rate: input.refresh_rate.or(Some(previous.refresh_rate.into())),
            process_names: input
                .process_names
                .or_else(|| Some(previous.process_names.clone())),
            vibrance: input.vibrance,
            is_default: None,
        };
        let updated = self.build_preset(&merged, Some(&previous))?;

        for preset in &mut self.settings.presets {
            if preset.id == id {
                *preset = updated.clone();
            }
        }

        match input.is_default {
            Some(true) => self.set_default_preset(id)?,
            Some(false) => self
                .settings
                .default_presets
                .retain(|item| item.preset_id != id),
            None => {}
        }
        self.reconcile_default_presets();
        self.save()
    }

    pub fn delete_preset(&mut self, id: &str) -> Result<(), String> {
        self.settings.presets.retain(|preset| preset.id != id);
        self.settings
            .default_presets
            .retain(|item| item.preset_id != id);
        self.active_process_presets.retain(|item| item != id);
        self.save()
    }

    pub fn set_default_preset(&mut self, preset_id: &str) -> Result<(), String> {
        let monitor_id = self
            .settings
            .presets
            .iter()
            .find(|preset| preset.id == preset_id)
            .map(|preset| preset.monitor_id.clone())
            .ok_or_else(|| t(self.locale(), "error.presetMissing"))?;

        self.settings
            .default_presets
            .retain(|item| item.monitor_id != monitor_id);
        self.settings.default_presets.push(DefaultPreset {
            monitor_id,
            preset_id: preset_id.to_owned(),
            updated_at: now(),
        });
        self.save()
    }

    pub fn set_monitor_alias(&mut self, monitor_id: &str, name: &str) -> Result<(), String> {
        if !self.monitors.iter().any(|monitor| monitor.id == monitor_id) {
            return Err(t(self.locale(), "error.selectCurrentMonitor"));
        }

        self.settings
            .monitor_aliases
            .retain(|alias| alias.monitor_id != monitor_id);
        let name = name.trim();
        if !name.is_empty() {
            self.settings.monitor_aliases.push(MonitorAlias {
                monitor_id: monitor_id.to_owned(),
                name: name.to_owned(),
                updated_at: now(),
            });
        }
        self.save()
    }

    pub fn set_autostart(&mut self, enabled: bool) -> Result<(), String> {
        self.settings.autostart = enabled;
        self.save()
    }

    pub fn set_restart_explorer(&mut self, enabled: bool) -> Result<(), String> {
        self.settings.restart_explorer_after_apply = enabled;
        self.save()
    }

    pub fn set_process_watch_interval(&mut self, interval_ms: f64) -> Result<(), String> {
        if !interval_ms.is_finite() {
            return Err(t(self.locale(), "error.processWatchIntervalInvalid"));
        }
        let rounded = interval_ms.round();
        if rounded < MIN_PROCESS_WATCH_INTERVAL_MS as f64
            || rounded > MAX_PROCESS_WATCH_INTERVAL_MS as f64
        {
            return Err(tr(
                self.locale(),
                "error.processWatchIntervalInvalidRange",
                &[
                    ("min", &(MIN_PROCESS_WATCH_INTERVAL_MS as f64 / 1000.0)),
                    ("max", &(MAX_PROCESS_WATCH_INTERVAL_MS as f64 / 1000.0)),
                ],
            ));
        }
        self.settings.process_watch_interval_ms = rounded as u64;
        self.save()
    }

    pub fn set_language(&mut self, language: Locale) -> Result<(), String> {
        self.settings.language = language;
        self.save()
    }

    pub fn set_theme_mode(&mut self, theme_mode: ThemeMode) -> Result<(), String> {
        self.settings.theme_mode = theme_mode;
        self.save()
    }

    pub fn can_apply_preset(&self, preset: &Preset) -> bool {
        self.find_monitor_for_preset(preset).is_some()
    }

    /// Applies presets, keeping only the last one per monitor.
    pub fn apply_presets(&mut self, ids: &[String]) -> Result<ApplyOutcome, String> {
        let locale = self.locale();
        let mut applications: Vec<(Preset, MonitorInfo)> = Vec::new();

        for id in ids {
            let preset = self
                .settings
                .presets
                .iter()
                .find(|preset| &preset.id == id)
                .cloned()
                .ok_or_else(|| t(locale, "error.presetMissing"))?;
            let monitor = self
                .find_monitor_for_preset(&preset)
                .cloned()
                .ok_or_else(|| {
                    tr(
                        locale,
                        "error.monitorUnavailable",
                        &[("name", &preset.name)],
                    )
                })?;

            applications.retain(|(existing, _)| existing.monitor_id != preset.monitor_id);
            applications.push((preset, monitor));
        }

        if applications.is_empty() {
            return Ok(ApplyOutcome {
                results: Vec::new(),
                refresh_error: None,
            });
        }

        for (preset, monitor) in &applications {
            let mode = DisplayMode {
                width: preset.width,
                height: preset.height,
                refresh_rate: preset.refresh_rate,
            };
            display::apply_mode(&monitor.device_name, mode)
                .map_err(|error| apply_error_message(locale, error, &monitor.device_name, mode))?;
            self.apply_vibrance(preset, monitor)?;
        }

        let refresh_error = self.refresh_monitors().err();
        let results = applications
            .iter()
            .map(|(preset, monitor)| ApplyPresetResult {
                preset_id: preset.id.clone(),
                preset_name: preset.name.clone(),
                message: tr(
                    locale,
                    "message.presetApplied",
                    &[
                        (
                            "mode",
                            &format_mode(preset.width, preset.height, preset.refresh_rate),
                        ),
                        ("monitorName", &self.monitor_display_name(monitor)),
                    ],
                ),
            })
            .collect();

        Ok(ApplyOutcome {
            results,
            refresh_error,
        })
    }

    fn apply_vibrance(&mut self, preset: &Preset, monitor: &MonitorInfo) -> Result<(), String> {
        let device = &monitor.device_name;
        let result = match preset.vibrance {
            Some(percent) => {
                if !self.vibrance_baselines.contains_key(device)
                    && let Some(reading) = vibrance::read(device)
                {
                    self.vibrance_baselines
                        .insert(device.clone(), reading.snapshot);
                }
                vibrance::set_percent(device, percent)
            }
            None => match self.vibrance_baselines.remove(device) {
                Some(snapshot) => vibrance::restore(device, snapshot),
                None => Ok(()),
            },
        };

        result.map_err(|error| match error {
            vibrance::SetError::Unsupported => tr(
                self.locale(),
                "display.vibranceUnsupported",
                &[("monitorName", &self.monitor_display_name(monitor))],
            ),
            vibrance::SetError::Failed(vendor, code) => tr(
                self.locale(),
                "display.vibranceFailed",
                &[("vendor", &format!("{vendor:?}")), ("code", &code)],
            ),
        })
    }

    /// Puts back every vibrance level changed by presets; used when the app quits.
    pub fn restore_all_vibrance(&mut self) {
        for (device, snapshot) in self.vibrance_baselines.drain() {
            let _ = vibrance::restore(&device, snapshot);
        }
    }

    /// Updates the set of running process presets and returns presets to apply.
    pub fn evaluate_process_rules(&mut self, running: &HashSet<String>) -> Vec<String> {
        let process_presets: Vec<Preset> = self
            .settings
            .presets
            .iter()
            .filter(|preset| !preset.process_names.is_empty())
            .cloned()
            .collect();
        let mut changed_monitors: Vec<String> = Vec::new();
        let mut mark_changed = |monitor_id: &str| {
            if !changed_monitors.iter().any(|id| id == monitor_id) {
                changed_monitors.push(monitor_id.to_owned());
            }
        };

        let stale: Vec<String> = self
            .active_process_presets
            .iter()
            .filter(|id| !process_presets.iter().any(|preset| &preset.id == *id))
            .cloned()
            .collect();
        for id in stale {
            if let Some(preset) = self.settings.presets.iter().find(|preset| preset.id == id) {
                mark_changed(&preset.monitor_id);
            }
            self.active_process_presets.retain(|item| item != &id);
        }

        for preset in &process_presets {
            let is_running = preset
                .process_names
                .iter()
                .any(|name| running.contains(&settings::normalize_process_name(name)));
            let is_active = self.active_process_presets.contains(&preset.id);

            if is_running && !is_active {
                self.active_process_presets.push(preset.id.clone());
                mark_changed(&preset.monitor_id);
            } else if !is_running && is_active {
                self.active_process_presets.retain(|id| id != &preset.id);
                mark_changed(&preset.monitor_id);
            }
        }

        changed_monitors
            .iter()
            .filter_map(|monitor_id| {
                self.active_process_presets
                    .iter()
                    .rev()
                    .filter_map(|id| process_presets.iter().find(|preset| &preset.id == id))
                    .find(|preset| &preset.monitor_id == monitor_id)
                    .map(|preset| preset.id.clone())
                    .or_else(|| self.default_preset_for_monitor(monitor_id))
            })
            .collect()
    }

    pub fn monitor_display_name(&self, monitor: &MonitorInfo) -> String {
        self.settings
            .monitor_aliases
            .iter()
            .find(|alias| alias.monitor_id == monitor.id)
            .map(|alias| alias.name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| {
                tr(
                    self.locale(),
                    "monitor.groupTitle",
                    &[("number", &self.monitor_sort_order(monitor))],
                )
            })
    }

    pub fn monitor_sort_order(&self, monitor: &MonitorInfo) -> usize {
        self.settings
            .monitor_bindings
            .iter()
            .find(|binding| binding.monitor_id == monitor.id)
            .and_then(|binding| parse_display_number(&binding.device_name))
            .unwrap_or_else(|| {
                self.monitors
                    .iter()
                    .position(|item| item.id == monitor.id)
                    .map_or(1, |index| index + 1)
            })
    }

    pub fn preset_monitor_name(&self, preset: &Preset) -> String {
        if let Some(monitor) = self.find_monitor_for_preset(preset) {
            return self.monitor_display_name(monitor);
        }
        self.settings
            .monitor_aliases
            .iter()
            .find(|alias| alias.monitor_id == preset.monitor_id)
            .map(|alias| alias.name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| preset.monitor_name.clone())
    }

    pub fn find_monitor_for_preset(&self, preset: &Preset) -> Option<&MonitorInfo> {
        if let Some(monitor) = self
            .monitors
            .iter()
            .find(|item| item.id == preset.monitor_id)
        {
            return Some(monitor);
        }
        if !is_legacy_device_name(&preset.monitor_id) {
            return None;
        }
        self.find_monitor_by_legacy_device_name(&preset.monitor_id)
            .or_else(|| {
                self.monitors
                    .iter()
                    .find(|item| item.device_name == preset.monitor_id)
            })
    }

    fn find_monitor_by_legacy_device_name(&self, device_name: &str) -> Option<&MonitorInfo> {
        self.settings
            .monitor_bindings
            .iter()
            .filter(|binding| binding.device_name == device_name)
            .find_map(|binding| {
                self.monitors
                    .iter()
                    .find(|monitor| monitor.id == binding.monitor_id)
            })
    }

    fn default_preset_for_monitor(&self, monitor_id: &str) -> Option<String> {
        let preset_id = &self
            .settings
            .default_presets
            .iter()
            .find(|item| item.monitor_id == monitor_id)?
            .preset_id;
        self.settings
            .presets
            .iter()
            .find(|preset| &preset.id == preset_id)
            .map(|preset| preset.id.clone())
    }

    fn build_preset(
        &self,
        input: &PresetInput,
        previous: Option<&Preset>,
    ) -> Result<Preset, String> {
        let locale = self.locale();
        let monitor = input
            .monitor_id
            .as_deref()
            .and_then(|id| self.monitors.iter().find(|monitor| monitor.id == id))
            .ok_or_else(|| t(locale, "error.selectCurrentMonitor"))?;

        let name = input.name.as_deref().unwrap_or_default().trim().to_owned();
        if name.is_empty() {
            return Err(t(locale, "error.presetNameRequired"));
        }

        let width = validate_range(input.width, 640, 10000)
            .ok_or_else(|| t(locale, "error.widthInvalid"))?;
        let height = validate_range(input.height, 480, 10000)
            .ok_or_else(|| t(locale, "error.heightInvalid"))?;
        let refresh_rate = validate_range(input.refresh_rate, 30, 1000)
            .ok_or_else(|| t(locale, "error.refreshRateInvalid"))?;
        let vibrance = match input.vibrance {
            None => None,
            Some(value) => Some(
                validate_range(
                    Some(value),
                    vibrance::MIN_PERCENT.into(),
                    vibrance::MAX_PERCENT.into(),
                )
                .ok_or_else(|| t(locale, "error.vibranceInvalid"))?,
            ),
        };

        let timestamp = now();
        Ok(Preset {
            id: previous.map_or_else(|| uuid::Uuid::new_v4().to_string(), |p| p.id.clone()),
            name,
            monitor_id: monitor.id.clone(),
            monitor_name: self.monitor_display_name(monitor),
            width,
            height,
            refresh_rate,
            process_names: settings::normalize_process_names(
                input.process_names.iter().flatten().map(String::as_str),
            ),
            vibrance,
            created_at: previous.map_or_else(|| timestamp.clone(), |p| p.created_at.clone()),
            updated_at: timestamp,
        })
    }

    fn remember_monitor_bindings(&mut self) {
        let mut changed = false;
        for monitor in &self.monitors {
            if self
                .settings
                .monitor_bindings
                .iter()
                .any(|binding| binding.device_name == monitor.device_name)
            {
                continue;
            }
            self.settings.monitor_bindings.push(MonitorBinding {
                device_name: monitor.device_name.clone(),
                monitor_id: monitor.id.clone(),
                monitor_name: monitor.name.clone(),
                updated_at: now(),
            });
            changed = true;
        }
        if changed {
            self.settings
                .monitor_bindings
                .sort_by(|left, right| left.device_name.cmp(&right.device_name));
        }
    }

    fn migrate_legacy_preset_monitor_ids(&mut self) {
        if self.settings.monitor_bindings.is_empty() {
            return;
        }

        let mut changed = false;
        for index in 0..self.settings.presets.len() {
            let preset = &self.settings.presets[index];
            if !is_legacy_device_name(&preset.monitor_id) {
                continue;
            }
            let Some(monitor) = self
                .find_monitor_by_legacy_device_name(&preset.monitor_id)
                .cloned()
            else {
                continue;
            };
            let monitor_name = self.monitor_display_name(&monitor);
            let preset = &mut self.settings.presets[index];
            preset.monitor_id = monitor.id;
            preset.monitor_name = monitor_name;
            preset.updated_at = now();
            changed = true;
        }

        if changed {
            self.reconcile_default_presets();
        }
    }

    pub fn reconcile_default_presets(&mut self) {
        let mut used_monitors: Vec<String> = Vec::new();
        let mut next: Vec<DefaultPreset> = Vec::new();

        for item in &self.settings.default_presets {
            let Some(preset) = self
                .settings
                .presets
                .iter()
                .find(|preset| preset.id == item.preset_id)
            else {
                continue;
            };
            if used_monitors.contains(&preset.monitor_id) {
                continue;
            }
            used_monitors.push(preset.monitor_id.clone());
            next.push(DefaultPreset {
                monitor_id: preset.monitor_id.clone(),
                ..item.clone()
            });
        }

        self.settings.default_presets = next;
    }
}

fn apply_error_message(
    locale: Locale,
    error: ApplyError,
    device_name: &str,
    mode: DisplayMode,
) -> String {
    let mode = format_mode(mode.width, mode.height, mode.refresh_rate);
    match error {
        ApplyError::ReadCurrentFailed => tr(
            locale,
            "display.readCurrentFailed",
            &[("deviceName", &device_name)],
        ),
        ApplyError::TestRejected(code) => tr(
            locale,
            "display.testRejected",
            &[("code", &code), ("mode", &mode)],
        ),
        ApplyError::ApplyFailed(code) => tr(
            locale,
            "display.applyFailed",
            &[("code", &code), ("mode", &mode)],
        ),
    }
}

fn validate_range(value: Option<i64>, min: i64, max: i64) -> Option<u32> {
    value
        .filter(|value| (min..=max).contains(value))
        .map(|value| value as u32)
}

fn is_legacy_device_name(value: &str) -> bool {
    value
        .strip_prefix("\\\\.\\")
        .and_then(|rest| {
            rest.get(..7)
                .filter(|p| p.eq_ignore_ascii_case("DISPLAY"))
                .map(|_| &rest[7..])
        })
        .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit()))
}

fn parse_display_number(device_name: &str) -> Option<usize> {
    let upper = device_name.to_ascii_uppercase();
    let digits = &upper[upper.rfind("DISPLAY")? + "DISPLAY".len()..];
    if digits.is_empty() || !digits.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|value| *value > 0)
}

fn now() -> String {
    humantime::format_rfc3339_millis(SystemTime::now()).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(id: &str, device: &str) -> MonitorInfo {
        let mode = DisplayMode {
            width: 1920,
            height: 1080,
            refresh_rate: 60,
        };
        MonitorInfo {
            id: id.into(),
            name: id.into(),
            device_name: device.into(),
            current: mode,
            modes: vec![mode],
            vibrance: None,
        }
    }

    fn preset(id: &str, monitor_id: &str, processes: &[&str]) -> Preset {
        Preset {
            id: id.into(),
            name: id.into(),
            monitor_id: monitor_id.into(),
            monitor_name: monitor_id.into(),
            width: 1280,
            height: 960,
            refresh_rate: 60,
            process_names: processes.iter().map(|name| name.to_string()).collect(),
            vibrance: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn core() -> Core {
        let mut core = Core {
            settings: AppSettings::default(),
            monitors: vec![monitor("m1", "\\\\.\\DISPLAY1")],
            available_update: None,
            app_version: String::new(),
            settings_path: PathBuf::new(),
            active_process_presets: Vec::new(),
            vibrance_baselines: HashMap::new(),
        };
        core.settings.presets = vec![
            preset("default", "m1", &[]),
            preset("cs", "m1", &["cs2.exe"]),
            preset("valorant", "m1", &["valorant.exe"]),
        ];
        core.settings.default_presets = vec![DefaultPreset {
            monitor_id: "m1".into(),
            preset_id: "default".into(),
            updated_at: String::new(),
        }];
        core
    }

    fn running(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn process_start_and_exit_switch_between_trigger_and_default() {
        let mut core = core();
        assert_eq!(
            core.evaluate_process_rules(&running(&["cs2.exe"])),
            vec!["cs"]
        );
        assert!(
            core.evaluate_process_rules(&running(&["cs2.exe"]))
                .is_empty()
        );
        assert_eq!(core.evaluate_process_rules(&running(&[])), vec!["default"]);
    }

    #[test]
    fn latest_started_process_wins_and_previous_resumes_after_exit() {
        let mut core = core();
        core.evaluate_process_rules(&running(&["cs2.exe"]));
        assert_eq!(
            core.evaluate_process_rules(&running(&["cs2.exe", "valorant.exe"])),
            vec!["valorant"]
        );
        assert_eq!(
            core.evaluate_process_rules(&running(&["cs2.exe"])),
            vec!["cs"]
        );
    }

    #[test]
    fn legacy_preset_resolves_through_binding() {
        let mut core = core();
        core.settings.monitor_bindings.push(MonitorBinding {
            device_name: "\\\\.\\DISPLAY1".into(),
            monitor_id: "m1".into(),
            monitor_name: "m1".into(),
            updated_at: String::new(),
        });
        let legacy = preset("legacy", "\\\\.\\DISPLAY1", &[]);
        assert_eq!(
            core.find_monitor_for_preset(&legacy).map(|m| m.id.as_str()),
            Some("m1")
        );
        assert_eq!(parse_display_number("\\\\.\\DISPLAY12"), Some(12));
        assert!(!is_legacy_device_name("monitor:abc"));
    }
}
