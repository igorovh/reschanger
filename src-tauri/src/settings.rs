use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::i18n::{Locale, ThemeMode};

pub const SETTINGS_VERSION: u32 = 7;
pub const DEFAULT_PROCESS_WATCH_INTERVAL_MS: u64 = 1000;
pub const MIN_PROCESS_WATCH_INTERVAL_MS: u64 = 250;
pub const MAX_PROCESS_WATCH_INTERVAL_MS: u64 = 60000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorBinding {
    pub device_name: String,
    pub monitor_id: String,
    pub monitor_name: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorAlias {
    pub monitor_id: String,
    pub name: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub monitor_id: String,
    pub monitor_name: String,
    pub width: u32,
    pub height: u32,
    pub refresh_rate: u32,
    #[serde(default)]
    pub process_names: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPreset {
    pub monitor_id: String,
    pub preset_id: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub version: u32,
    pub autostart: bool,
    pub restart_explorer_after_apply: bool,
    pub process_watch_interval_ms: u64,
    pub language: Locale,
    pub theme_mode: ThemeMode,
    pub monitor_bindings: Vec<MonitorBinding>,
    pub monitor_aliases: Vec<MonitorAlias>,
    pub default_presets: Vec<DefaultPreset>,
    pub presets: Vec<Preset>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            autostart: false,
            restart_explorer_after_apply: false,
            process_watch_interval_ms: DEFAULT_PROCESS_WATCH_INTERVAL_MS,
            language: Locale::default(),
            theme_mode: ThemeMode::default(),
            monitor_bindings: Vec::new(),
            monitor_aliases: Vec::new(),
            default_presets: Vec::new(),
            presets: Vec::new(),
        }
    }
}

pub fn load(path: &Path) -> AppSettings {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => {
            let settings = AppSettings::default();
            let _ = save(path, &settings);
            return settings;
        }
    };

    match serde_json::from_str::<Value>(&raw) {
        Ok(value) => normalize(&value),
        Err(_) => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default();
            let _ = fs::rename(path, path.with_extension(format!("json.corrupt-{stamp}")));
            let settings = AppSettings::default();
            let _ = save(path, &settings);
            settings
        }
    }
}

pub fn save(path: &Path, settings: &AppSettings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temporary_path = PathBuf::from(format!("{}.tmp", path.display()));
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(&temporary_path, format!("{json}\n"))?;
    fs::rename(temporary_path, path)
}

/// Field-by-field normalization so one malformed entry never discards the whole file.
fn normalize(value: &Value) -> AppSettings {
    let defaults = AppSettings::default();
    if !value.is_object() {
        return defaults;
    }

    AppSettings {
        version: SETTINGS_VERSION,
        autostart: value["autostart"].as_bool().unwrap_or(false),
        restart_explorer_after_apply: value["restartExplorerAfterApply"]
            .as_bool()
            .unwrap_or(false),
        process_watch_interval_ms: clamp_interval(value["processWatchIntervalMs"].as_f64()),
        language: parse_or(&value["language"], defaults.language),
        theme_mode: parse_or(&value["themeMode"], defaults.theme_mode),
        monitor_bindings: parse_list(&value["monitorBindings"]),
        monitor_aliases: parse_list(&value["monitorAliases"]),
        default_presets: parse_list(&value["defaultPresets"]),
        presets: value["presets"]
            .as_array()
            .map(|items| items.iter().filter_map(normalize_preset).collect())
            .unwrap_or_default(),
    }
}

fn normalize_preset(value: &Value) -> Option<Preset> {
    let mut preset: Preset = serde_json::from_value(value.clone()).ok()?;
    let raw_names: Vec<&str> = match value["processNames"].as_array() {
        Some(items) => items.iter().filter_map(Value::as_str).collect(),
        None => value["processName"].as_str().into_iter().collect(),
    };
    preset.process_names = normalize_process_names(raw_names);
    Some(preset)
}

pub fn clamp_interval(value: Option<f64>) -> u64 {
    match value {
        Some(value) if value.is_finite() => (value.round().max(0.0) as u64)
            .clamp(MIN_PROCESS_WATCH_INTERVAL_MS, MAX_PROCESS_WATCH_INTERVAL_MS),
        _ => DEFAULT_PROCESS_WATCH_INTERVAL_MS,
    }
}

pub fn normalize_process_names<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for value in values {
        let normalized = normalize_process_name(value);
        if !normalized.is_empty() && !names.contains(&normalized) {
            names.push(normalized);
        }
    }
    names
}

pub fn normalize_process_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let file_name = trimmed.rsplit(['\\', '/']).next().unwrap_or(trimmed);
    let lower = file_name.to_lowercase();
    if lower.ends_with(".exe") {
        lower
    } else {
        format!("{lower}.exe")
    }
}

fn parse_or<T: DeserializeOwned>(value: &Value, fallback: T) -> T {
    serde_json::from_value(value.clone()).unwrap_or(fallback)
}

fn parse_list<T: DeserializeOwned>(value: &Value) -> Vec<T> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_valid_entries_and_migrates_legacy_process_name() {
        let settings = normalize(&json!({
            "language": "en",
            "themeMode": "neon",
            "processWatchIntervalMs": 10,
            "presets": [
                {
                    "id": "a", "name": "CS", "monitorId": "m", "monitorName": "M",
                    "width": 1280, "height": 960, "refreshRate": 240,
                    "processName": "C:\\Games\\CS2", "createdAt": "x", "updatedAt": "x"
                },
                { "id": "broken" }
            ]
        }));

        assert_eq!(settings.language, Locale::En);
        assert_eq!(settings.theme_mode, ThemeMode::Auto);
        assert_eq!(
            settings.process_watch_interval_ms,
            MIN_PROCESS_WATCH_INTERVAL_MS
        );
        assert_eq!(settings.presets.len(), 1);
        assert_eq!(settings.presets[0].process_names, vec!["cs2.exe"]);
    }
}
