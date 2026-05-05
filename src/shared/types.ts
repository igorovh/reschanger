import type { Locale } from "./i18n";

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

export type Preset = {
  id: string;
  name: string;
  monitorId: string;
  monitorName: string;
  width: number;
  height: number;
  refreshRate: number;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  version: 1;
  autostart: boolean;
  language: Locale;
  presets: Preset[];
};

export type AppState = {
  settings: AppSettings;
  monitors: MonitorInfo[];
};

export type CreatePresetInput = {
  name: string;
  monitorId: string;
  width: number;
  height: number;
  refreshRate: number;
};

export type UpdatePresetInput = Partial<CreatePresetInput>;

export type ApplyPresetResult = {
  presetId: string;
  presetName: string;
  message: string;
};

export type AppErrorPayload = {
  title: string;
  message: string;
};
