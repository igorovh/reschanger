#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod display;
mod i18n;
mod settings;
mod system;
mod tray;
mod updates;
mod vibrance;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

use crate::core::{AppError, ApplyPresetResult, Core};
use crate::i18n::t;

pub const MAIN_WINDOW: &str = "main";
const EXPLORER_RESTART_DELAY: Duration = Duration::from_secs(3);
const PROCESS_WATCH_ERROR_THROTTLE: Duration = Duration::from_secs(60);

pub struct AppCore {
    core: Mutex<Core>,
    explorer_restart_generation: AtomicU64,
}

impl AppCore {
    pub fn lock(&self) -> MutexGuard<'_, Core> {
        self.core
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::refresh_monitors,
            commands::create_preset,
            commands::update_preset,
            commands::delete_preset,
            commands::apply_preset,
            commands::set_default_preset,
            commands::set_monitor_alias,
            commands::set_autostart,
            commands::set_restart_explorer,
            commands::set_process_watch_interval,
            commands::set_language,
            commands::set_theme_mode,
            commands::check_for_updates,
            commands::install_update,
        ])
        .setup(|app| {
            let settings_path = app
                .path()
                .config_dir()?
                .join("reschanger")
                .join("settings.json");
            let mut core = Core::new(settings_path, app.package_info().version.to_string());
            if let Err(error) = core.refresh_monitors() {
                system::show_error_box(error.title, error.message);
            }
            core.reconcile_default_presets();
            let autostart = core.settings.autostart;

            app.manage(AppCore {
                core: Mutex::new(core),
                explorer_restart_generation: AtomicU64::new(0),
            });

            system::remove_legacy_autostart_entries();
            sync_autostart(app.handle(), autostart);
            tray::create(app.handle())?;
            start_process_watcher(app.handle().clone());
            updates::start_background_checks(app.handle().clone());

            if !std::env::args().any(|arg| arg == "--hidden") {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build reschanger")
        .run(|app, event| match event {
            // Closing the window destroys the webview; the tray keeps the process alive.
            RunEvent::ExitRequested {
                api, code: None, ..
            } => api.prevent_exit(),
            RunEvent::Exit => app.state::<AppCore>().lock().restore_all_vibrance(),
            _ => {}
        });
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let created = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
        .title("reschanger")
        .inner_size(980.0, 720.0)
        .min_inner_size(860.0, 620.0)
        .center()
        .focused(true)
        .build();
    if let Ok(window) = created {
        let _ = window.set_focus();
    }
}

pub fn is_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn broadcast_state(app: &AppHandle) {
    let state = app.state::<AppCore>().lock().state();
    let _ = app.emit("state-changed", state);
    tray::rebuild(app);
}

pub fn report_error(app: &AppHandle, error: AppError) {
    let _ = app.emit("app-error", error.clone());
    if !is_window_visible(app) {
        system::show_error_box(error.title, error.message);
    }
}

/// Applies presets and handles all side effects; returns the error message on failure.
pub fn apply_presets(app: &AppHandle, ids: &[String]) -> Result<(), String> {
    let outcome = app.state::<AppCore>().lock().apply_presets(ids)?;
    if outcome.results.is_empty() {
        return Ok(());
    }

    schedule_explorer_restart(app);
    if let Some(error) = outcome.refresh_error {
        report_error(app, error);
    }
    broadcast_state(app);
    for result in outcome.results {
        let _ = app.emit::<ApplyPresetResult>("preset-applied", result);
    }
    Ok(())
}

pub fn sync_autostart(app: &AppHandle, enabled: bool) {
    let launcher = app.autolaunch();
    let _ = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
}

fn schedule_explorer_restart(app: &AppHandle) {
    let state = app.state::<AppCore>();
    if !state.lock().settings.restart_explorer_after_apply {
        return;
    }

    let generation = state
        .explorer_restart_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(EXPLORER_RESTART_DELAY);
        let state = app.state::<AppCore>();
        let still_latest = state.explorer_restart_generation.load(Ordering::SeqCst) == generation;
        if still_latest && state.lock().settings.restart_explorer_after_apply {
            system::restart_explorer();
        }
    });
}

pub fn cancel_explorer_restart(app: &AppHandle) {
    app.state::<AppCore>()
        .explorer_restart_generation
        .fetch_add(1, Ordering::SeqCst);
}

fn start_process_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut last_error: Option<Instant> = None;
        loop {
            let result = system::running_process_names().and_then(|running| {
                let targets = app
                    .state::<AppCore>()
                    .lock()
                    .evaluate_process_rules(&running);
                apply_presets(&app, &targets)
            });

            if let Err(message) = result
                && last_error.is_none_or(|at| at.elapsed() > PROCESS_WATCH_ERROR_THROTTLE)
            {
                last_error = Some(Instant::now());
                let locale = app.state::<AppCore>().lock().locale();
                report_error(
                    &app,
                    AppError {
                        title: t(locale, "error.processWatchFailed"),
                        message,
                    },
                );
            }

            let interval = app
                .state::<AppCore>()
                .lock()
                .settings
                .process_watch_interval_ms;
            thread::sleep(Duration::from_millis(interval));
        }
    });
}
