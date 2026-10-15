use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::core::AvailableUpdate;
use crate::i18n::t;
use crate::{AppCore, broadcast_state};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

pub fn start_background_checks(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let _ = tauri::async_runtime::block_on(check(&app));
            thread::sleep(CHECK_INTERVAL);
        }
    });
}

/// Checks the release feed and records the result in app state; returns whether an update exists.
pub async fn check(app: &AppHandle) -> Result<bool, String> {
    let locale = app.state::<AppCore>().lock().locale();
    let update = app
        .updater()
        .map_err(|error| format!("{} {error}", t(locale, "update.failed")))?
        .check()
        .await
        .map_err(|error| format!("{} {error}", t(locale, "update.failed")))?;

    let available = update.map(|update| AvailableUpdate {
        version: update.version,
        notes: update.body,
    });
    let found = available.is_some();
    app.state::<AppCore>().lock().available_update = available;
    broadcast_state(app);
    Ok(found)
}

/// Downloads and runs the installer; on Windows the updater exits the app before installing.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let locale = app.state::<AppCore>().lock().locale();
    let failed = |error: tauri_plugin_updater::Error| {
        format!("{} {error}", t(locale, "update.installFailed"))
    };

    let Some(update) = app
        .updater()
        .map_err(failed)?
        .check()
        .await
        .map_err(failed)?
    else {
        app.state::<AppCore>().lock().available_update = None;
        broadcast_state(app);
        return Ok(());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(failed)?;
    app.restart();
}
