import type { Locale, ThemeMode } from "../../shared/i18n";
import type {
  AppErrorPayload,
  ApplyPresetResult,
  AppState,
  CreatePresetInput,
  UpdatePresetInput,
} from "../../shared/types";

export type ReschangerApi = {
  getState: () => Promise<AppState>;
  refreshMonitors: () => Promise<AppState>;
  createPreset: (input: CreatePresetInput) => Promise<AppState>;
  updatePreset: (id: string, input: UpdatePresetInput) => Promise<AppState>;
  deletePreset: (id: string) => Promise<AppState>;
  applyPreset: (id: string) => Promise<AppState>;
  setAutostart: (enabled: boolean) => Promise<AppState>;
  setLanguage: (language: Locale) => Promise<AppState>;
  setThemeMode: (themeMode: ThemeMode) => Promise<AppState>;
  onStateChanged: (callback: (state: AppState) => void) => () => void;
  onPresetApplied: (
    callback: (result: ApplyPresetResult) => void,
  ) => () => void;
  onAppError: (callback: (error: AppErrorPayload) => void) => () => void;
};

declare global {
  interface Window {
    reschanger: ReschangerApi;
  }
}

export const api = window.reschanger;
