import { contextBridge, ipcRenderer } from "electron";
import type {
  AppErrorPayload,
  AppState,
  ApplyPresetResult,
  CreatePresetInput,
  UpdatePresetInput
} from "../shared/types";

export type ReschangerApi = {
  getState: () => Promise<AppState>;
  refreshMonitors: () => Promise<AppState>;
  createPreset: (input: CreatePresetInput) => Promise<AppState>;
  updatePreset: (id: string, input: UpdatePresetInput) => Promise<AppState>;
  deletePreset: (id: string) => Promise<AppState>;
  applyPreset: (id: string) => Promise<AppState>;
  setAutostart: (enabled: boolean) => Promise<AppState>;
  onStateChanged: (callback: (state: AppState) => void) => () => void;
  onPresetApplied: (callback: (result: ApplyPresetResult) => void) => () => void;
  onAppError: (callback: (error: AppErrorPayload) => void) => () => void;
};

const api: ReschangerApi = {
  getState: () => ipcRenderer.invoke("state:get") as Promise<AppState>,
  refreshMonitors: () => ipcRenderer.invoke("monitors:refresh") as Promise<AppState>,
  createPreset: (input) => ipcRenderer.invoke("presets:create", input) as Promise<AppState>,
  updatePreset: (id, input) => ipcRenderer.invoke("presets:update", id, input) as Promise<AppState>,
  deletePreset: (id) => ipcRenderer.invoke("presets:delete", id) as Promise<AppState>,
  applyPreset: (id) => ipcRenderer.invoke("presets:apply", id) as Promise<AppState>,
  setAutostart: (enabled) => ipcRenderer.invoke("autostart:set", enabled) as Promise<AppState>,
  onStateChanged: (callback) => subscribe("state:changed", callback),
  onPresetApplied: (callback) => subscribe("preset:applied", callback),
  onAppError: (callback) => subscribe("app:error", callback)
};

contextBridge.exposeInMainWorld("reschanger", api);

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
