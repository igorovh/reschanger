import type { Locale, ThemeMode } from "./i18n";

export const DEFAULT_PROCESS_WATCH_INTERVAL_MS = 1000;
export const MIN_PROCESS_WATCH_INTERVAL_MS = 250;
export const MAX_PROCESS_WATCH_INTERVAL_MS = 60000;

export type DisplayMode = {
  width: number;
  height: number;
  refreshRate: number;
};

export type MonitorInfo = {
  id: string;
  name: string;
  deviceName: string;
  current: DisplayMode;
  modes: DisplayMode[];
};

export type MonitorBinding = {
  deviceName: string;
  monitorId: string;
  monitorName: string;
  updatedAt: string;
};

export type MonitorAlias = {
  monitorId: string;
  name: string;
  updatedAt: string;
};

export type Preset = {
  id: string;
  name: string;
  monitorId: string;
  monitorName: string;
  width: number;
  height: number;
  refreshRate: number;
  processNames: string[];
  createdAt: string;
  updatedAt: string;
};

export type DefaultPreset = {
  monitorId: string;
  presetId: string;
  updatedAt: string;
};

export type AppSettings = {
  version: 7;
  autostart: boolean;
  restartExplorerAfterApply: boolean;
  processWatchIntervalMs: number;
  language: Locale;
  themeMode: ThemeMode;
  monitorBindings: MonitorBinding[];
  monitorAliases: MonitorAlias[];
  defaultPresets: DefaultPreset[];
  presets: Preset[];
};

export type AvailableUpdate = {
  version: string;
  notes: string | null;
};

export type AppState = {
  settings: AppSettings;
  monitors: MonitorInfo[];
  appVersion: string;
  availableUpdate: AvailableUpdate | null;
};

export type UpdateCheckResult = {
  state: AppState;
  updateAvailable: boolean;
};

export type CreatePresetInput = {
  name: string;
  monitorId: string;
  width: number;
  height: number;
  refreshRate: number;
  processNames?: string[];
  isDefault?: boolean;
};

export type UpdatePresetInput = Partial<CreatePresetInput>;

export type SetMonitorAliasInput = {
  monitorId: string;
  name: string;
};

export type SetDefaultPresetInput = {
  presetId: string;
};

export type SetProcessWatchIntervalInput = {
  intervalMs: number;
};

export type ApplyPresetResult = {
  presetId: string;
  presetName: string;
  message: string;
};

export type AppErrorPayload = {
  title: string;
  message: string;
};
