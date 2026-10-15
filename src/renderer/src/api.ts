import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Locale, ThemeMode } from "../../shared/i18n";
import type {
  AppErrorPayload,
  ApplyPresetResult,
  AppState,
  CreatePresetInput,
  SetDefaultPresetInput,
  SetMonitorAliasInput,
  SetProcessWatchIntervalInput,
  UpdateCheckResult,
  UpdatePresetInput,
} from "../../shared/types";

export const api = {
  getState: () => call<AppState>("get_state"),
  refreshMonitors: () => call<AppState>("refresh_monitors"),
  createPreset: (input: CreatePresetInput) =>
    call<AppState>("create_preset", { input }),
  updatePreset: (id: string, input: UpdatePresetInput) =>
    call<AppState>("update_preset", { id, input }),
  deletePreset: (id: string) => call<AppState>("delete_preset", { id }),
  applyPreset: (id: string) => call<AppState>("apply_preset", { id }),
  setDefaultPreset: (input: SetDefaultPresetInput) =>
    call<AppState>("set_default_preset", { input }),
  setMonitorAlias: (input: SetMonitorAliasInput) =>
    call<AppState>("set_monitor_alias", { input }),
  setAutostart: (enabled: boolean) =>
    call<AppState>("set_autostart", { enabled }),
  setRestartExplorerAfterApply: (enabled: boolean) =>
    call<AppState>("set_restart_explorer", { enabled }),
  setProcessWatchInterval: (input: SetProcessWatchIntervalInput) =>
    call<AppState>("set_process_watch_interval", { input }),
  setLanguage: (language: Locale) =>
    call<AppState>("set_language", { language }),
  setThemeMode: (themeMode: ThemeMode) =>
    call<AppState>("set_theme_mode", { themeMode }),
  checkForUpdates: () => call<UpdateCheckResult>("check_for_updates"),
  installUpdate: () => call<void>("install_update"),
  onStateChanged: (callback: (state: AppState) => void) =>
    subscribe("state-changed", callback),
  onPresetApplied: (callback: (result: ApplyPresetResult) => void) =>
    subscribe("preset-applied", callback),
  onAppError: (callback: (error: AppErrorPayload) => void) =>
    subscribe("app-error", callback),
};

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // Rust commands reject with a plain string; normalize so callers can use Error#message.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function subscribe<T>(event: string, callback: (payload: T) => void) {
  const unlisten = listen<T>(event, (message) => callback(message.payload));
  return () => {
    void unlisten.then((dispose) => dispose());
  };
}
