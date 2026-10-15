use std::thread;

use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::core::Core;
use crate::i18n::{format_mode, t, tr};
use crate::{
    AppCore, apply_presets, broadcast_state, report_error, show_main_window, system, updates,
};

const TRAY_ID: &str = "main";
const PRESET_PREFIX: &str = "preset:";

struct PresetEntry {
    id: String,
    label: String,
    enabled: bool,
}

struct MonitorEntry {
    label: String,
    presets: Vec<PresetEntry>,
}

/// Plain snapshot of the menu so the core lock is not held while menus are created on the main thread.
struct MenuModel {
    open: String,
    install_update: Option<String>,
    no_presets: String,
    no_monitor_presets: String,
    monitors: Vec<MonitorEntry>,
    unavailable_group: String,
    unavailable: Vec<String>,
    refresh: String,
    check_updates: String,
    quit: String,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("reschanger")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn rebuild(app: &AppHandle) {
    let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) else {
        return;
    };
    let _ = tray.set_menu(Some(menu));
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    let app = app.clone();
    match id {
        "open" => show_main_window(&app),
        "quit" => app.exit(0),
        "refresh" => {
            thread::spawn(move || {
                let result = app.state::<AppCore>().lock().refresh_monitors();
                if let Err(error) = result {
                    report_error(&app, error);
                }
                broadcast_state(&app);
            });
        }
        "check-updates" => {
            thread::spawn(move || {
                if let Err(message) = tauri::async_runtime::block_on(updates::check(&app)) {
                    system::show_error_box("reschanger".into(), message);
                }
            });
        }
        "install-update" => {
            thread::spawn(move || {
                if let Err(message) = tauri::async_runtime::block_on(updates::install(&app)) {
                    system::show_error_box("reschanger".into(), message);
                }
            });
        }
        _ => {
            let Some(preset_id) = id.strip_prefix(PRESET_PREFIX).map(str::to_owned) else {
                return;
            };
            thread::spawn(move || {
                if let Err(message) = apply_presets(&app, &[preset_id]) {
                    system::show_error_box("reschanger".into(), message);
                }
            });
        }
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let model = menu_model(&app.state::<AppCore>().lock());
    let item = |id: &str, label: &str| MenuItemBuilder::with_id(id, label).build(app);
    let disabled = |label: &str| MenuItemBuilder::new(label).enabled(false).build(app);

    let mut menu = MenuBuilder::new(app).item(&item("open", &model.open)?);
    if let Some(label) = &model.install_update {
        menu = menu.item(&item("install-update", label)?);
    }
    menu = menu.separator();

    if model.monitors.is_empty() && model.unavailable.is_empty() {
        menu = menu.item(&disabled(&model.no_presets)?);
    }

    let mut submenus: Vec<Submenu<Wry>> = Vec::new();
    for monitor in &model.monitors {
        let mut submenu = SubmenuBuilder::new(app, &monitor.label);
        if monitor.presets.is_empty() {
            submenu = submenu.item(&disabled(&model.no_monitor_presets)?);
        }
        for preset in &monitor.presets {
            let entry: MenuItem<Wry> = MenuItemBuilder::with_id(&preset.id, &preset.label)
                .enabled(preset.enabled)
                .build(app)?;
            submenu = submenu.item(&entry);
        }
        submenus.push(submenu.build()?);
    }
    for submenu in &submenus {
        menu = menu.item(submenu);
    }

    if !model.unavailable.is_empty() {
        let mut submenu = SubmenuBuilder::new(app, &model.unavailable_group);
        for label in &model.unavailable {
            submenu = submenu.item(&disabled(label)?);
        }
        menu = menu.separator().item(&submenu.build()?);
    }

    menu.separator()
        .item(&item("refresh", &model.refresh)?)
        .item(&item("check-updates", &model.check_updates)?)
        .item(&item("quit", &model.quit)?)
        .build()
}

fn menu_model(core: &Core) -> MenuModel {
    let locale = core.locale();
    let mut monitors: Vec<_> = core.monitors.iter().collect();
    monitors.sort_by(|left, right| {
        core.monitor_sort_order(left)
            .cmp(&core.monitor_sort_order(right))
            .then_with(|| left.name.cmp(&right.name))
    });

    MenuModel {
        open: t(locale, "tray.openConfig"),
        install_update: core.available_update.as_ref().map(|update| {
            tr(
                locale,
                "tray.installUpdate",
                &[("version", &update.version)],
            )
        }),
        no_presets: t(locale, "tray.noPresets"),
        no_monitor_presets: t(locale, "tray.noMonitorPresets"),
        monitors: monitors
            .into_iter()
            .map(|monitor| MonitorEntry {
                label: core.monitor_display_name(monitor),
                presets: core
                    .settings
                    .presets
                    .iter()
                    .filter(|preset| {
                        core.find_monitor_for_preset(preset).map(|m| &m.id) == Some(&monitor.id)
                    })
                    .map(|preset| PresetEntry {
                        id: format!("{PRESET_PREFIX}{}", preset.id),
                        label: format!(
                            "{} - {}",
                            preset.name,
                            format_mode(preset.width, preset.height, preset.refresh_rate)
                        ),
                        enabled: core.can_apply_preset(preset),
                    })
                    .collect(),
            })
            .collect(),
        unavailable_group: t(locale, "preset.unavailableGroup"),
        unavailable: core
            .settings
            .presets
            .iter()
            .filter(|preset| core.find_monitor_for_preset(preset).is_none())
            .map(|preset| {
                tr(
                    locale,
                    "preset.trayLabel",
                    &[
                        ("name", &preset.name),
                        ("monitorName", &core.preset_monitor_name(preset)),
                        (
                            "mode",
                            &format_mode(preset.width, preset.height, preset.refresh_rate),
                        ),
                    ],
                )
            })
            .collect(),
        refresh: t(locale, "action.refreshMonitors"),
        check_updates: t(locale, "tray.checkUpdates"),
        quit: t(locale, "tray.quit"),
    }
}
