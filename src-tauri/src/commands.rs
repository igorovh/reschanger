use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::core::{AppState, Core, PresetInput};
use crate::i18n::{Locale, ThemeMode};
use crate::{
    AppCore, apply_presets, broadcast_state, cancel_explorer_restart, report_error, sync_autostart,
    updates,
};

type CommandResult<T = AppState> = Result<T, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPresetInput {
    preset_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorAliasInput {
    monitor_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessWatchIntervalInput {
    interval_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    state: AppState,
    update_available: bool,
}

/// Runs a mutation, then notifies the UI and tray about the new state.
fn mutate(app: &AppHandle, action: impl FnOnce(&mut Core) -> Result<(), String>) -> CommandResult {
    action(&mut app.state::<AppCore>().lock())?;
    broadcast_state(app);
    Ok(app.state::<AppCore>().lock().state())
}

#[tauri::command]
pub async fn get_state(state: State<'_, AppCore>) -> CommandResult {
    Ok(state.lock().state())
}

#[tauri::command]
pub async fn refresh_monitors(app: AppHandle) -> CommandResult {
    let result = app.state::<AppCore>().lock().refresh_monitors();
    if let Err(error) = result {
        report_error(&app, error);
    }
    broadcast_state(&app);
    Ok(app.state::<AppCore>().lock().state())
}

#[tauri::command]
pub async fn create_preset(app: AppHandle, input: PresetInput) -> CommandResult {
    mutate(&app, |core| core.create_preset(input))
}

#[tauri::command]
pub async fn update_preset(app: AppHandle, id: String, input: PresetInput) -> CommandResult {
    mutate(&app, |core| core.update_preset(&id, input))
}

#[tauri::command]
pub async fn delete_preset(app: AppHandle, id: String) -> CommandResult {
    mutate(&app, |core| core.delete_preset(&id))
}

#[tauri::command]
pub async fn apply_preset(app: AppHandle, id: String) -> CommandResult {
    apply_presets(&app, &[id])?;
    Ok(app.state::<AppCore>().lock().state())
}

#[tauri::command]
pub async fn set_default_preset(app: AppHandle, input: DefaultPresetInput) -> CommandResult {
    mutate(&app, |core| core.set_default_preset(&input.preset_id))
}

#[tauri::command]
pub async fn set_monitor_alias(app: AppHandle, input: MonitorAliasInput) -> CommandResult {
    mutate(&app, |core| {
        core.set_monitor_alias(&input.monitor_id, &input.name)
    })
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> CommandResult {
    sync_autostart(&app, enabled);
    mutate(&app, |core| core.set_autostart(enabled))
}

#[tauri::command]
pub async fn set_restart_explorer(app: AppHandle, enabled: bool) -> CommandResult {
    if !enabled {
        cancel_explorer_restart(&app);
    }
    mutate(&app, |core| core.set_restart_explorer(enabled))
}

#[tauri::command]
pub async fn set_process_watch_interval(
    app: AppHandle,
    input: ProcessWatchIntervalInput,
) -> CommandResult {
    mutate(&app, |core| {
        core.set_process_watch_interval(input.interval_ms)
    })
}

#[tauri::command]
pub async fn set_language(app: AppHandle, language: Locale) -> CommandResult {
    mutate(&app, |core| core.set_language(language))
}

#[tauri::command]
pub async fn set_theme_mode(app: AppHandle, theme_mode: ThemeMode) -> CommandResult {
    mutate(&app, |core| core.set_theme_mode(theme_mode))
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> CommandResult<UpdateCheckResult> {
    let update_available = updates::check(&app).await?;
    Ok(UpdateCheckResult {
        state: app.state::<AppCore>().lock().state(),
        update_available,
    })
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> CommandResult<()> {
    updates::install(&app).await
}
