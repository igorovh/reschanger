import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { Locale, ThemeMode } from "../shared/i18n";
import type {
  AppErrorPayload,
  ApplyPresetResult,
  AppState,
  CreatePresetInput,
  SetDefaultPresetInput,
  SetMonitorAliasInput,
  SetProcessWatchIntervalInput,
  UpdatePresetInput,
} from "../shared/types";

export type ReschangerApi = {
  getState: () => Promise<AppState>;
  refreshMonitors: () => Promise<AppState>;
  createPreset: (input: CreatePresetInput) => Promise<AppState>;
  updatePreset: (id: string, input: UpdatePresetInput) => Promise<AppState>;
  deletePreset: (id: string) => Promise<AppState>;
  applyPreset: (id: string) => Promise<AppState>;
  setDefaultPreset: (input: SetDefaultPresetInput) => Promise<AppState>;
  setMonitorAlias: (input: SetMonitorAliasInput) => Promise<AppState>;
  setAutostart: (enabled: boolean) => Promise<AppState>;
  setRestartExplorerAfterApply: (enabled: boolean) => Promise<AppState>;
  setProcessWatchInterval: (
    input: SetProcessWatchIntervalInput,
  ) => Promise<AppState>;
  setLanguage: (language: Locale) => Promise<AppState>;
  setThemeMode: (themeMode: ThemeMode) => Promise<AppState>;
  onStateChanged: (callback: (state: AppState) => void) => () => void;
  onPresetApplied: (
    callback: (result: ApplyPresetResult) => void,
  ) => () => void;
  onAppError: (callback: (error: AppErrorPayload) => void) => () => void;
};

const api: ReschangerApi = {
  getState: () => ipcRenderer.invoke("state:get") as Promise<AppState>,
  refreshMonitors: () =>
    ipcRenderer.invoke("monitors:refresh") as Promise<AppState>,
  createPreset: (input) =>
    ipcRenderer.invoke("presets:create", input) as Promise<AppState>,
  updatePreset: (id, input) =>
    ipcRenderer.invoke("presets:update", id, input) as Promise<AppState>,
  deletePreset: (id) =>
    ipcRenderer.invoke("presets:delete", id) as Promise<AppState>,
  applyPreset: (id) =>
    ipcRenderer.invoke("presets:apply", id) as Promise<AppState>,
  setDefaultPreset: (input) =>
    ipcRenderer.invoke("presets:default:set", input) as Promise<AppState>,
  setMonitorAlias: (input) =>
    ipcRenderer.invoke("monitors:alias:set", input) as Promise<AppState>,
  setAutostart: (enabled) =>
    ipcRenderer.invoke("autostart:set", enabled) as Promise<AppState>,
  setRestartExplorerAfterApply: (enabled) =>
    ipcRenderer.invoke("explorer-restart:set", enabled) as Promise<AppState>,
  setProcessWatchInterval: (input) =>
    ipcRenderer.invoke(
      "process-watch-interval:set",
      input,
    ) as Promise<AppState>,
  setLanguage: (language) =>
    ipcRenderer.invoke("language:set", language) as Promise<AppState>,
  setThemeMode: (themeMode) =>
    ipcRenderer.invoke("theme:set", themeMode) as Promise<AppState>,
  onStateChanged: (callback) => subscribe("state:changed", callback),
  onPresetApplied: (callback) => subscribe("preset:applied", callback),
  onAppError: (callback) => subscribe("app:error", callback),
};

contextBridge.exposeInMainWorld("reschanger", api);

function subscribe<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
