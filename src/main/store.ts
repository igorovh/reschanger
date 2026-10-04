import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  DEFAULT_LOCALE,
  DEFAULT_THEME_MODE,
  isLocale,
  isThemeMode,
  type Locale,
  type ThemeMode,
} from "../shared/i18n";
import type {
  AppSettings,
  DefaultPreset,
  MonitorAlias,
  MonitorBinding,
  Preset,
} from "../shared/types";
import {
  DEFAULT_PROCESS_WATCH_INTERVAL_MS,
  MAX_PROCESS_WATCH_INTERVAL_MS,
  MIN_PROCESS_WATCH_INTERVAL_MS,
} from "../shared/types";

const SETTINGS_VERSION = 7;

const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  autostart: false,
  restartExplorerAfterApply: false,
  processWatchIntervalMs: DEFAULT_PROCESS_WATCH_INTERVAL_MS,
  language: DEFAULT_LOCALE,
  themeMode: DEFAULT_THEME_MODE,
  monitorBindings: [],
  monitorAliases: [],
  defaultPresets: [],
  presets: [],
};

export class SettingsStore {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private readonly filePath: string;

  constructor() {
    this.filePath = join(app.getPath("userData"), "settings.json");
  }

  get path(): string {
    return this.filePath;
  }

  getSettings(): AppSettings {
    return structuredClone(this.settings);
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.settings = normalizeSettings(parsed);
    } catch (error) {
      if (isMissingFileError(error)) {
        this.settings = structuredClone(DEFAULT_SETTINGS);
        await this.save();
        return this.getSettings();
      }

      await this.backupCorruptFile();
      this.settings = structuredClone(DEFAULT_SETTINGS);
      await this.save();
    }

    return this.getSettings();
  }

  async setAutostart(enabled: boolean): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      autostart: enabled,
    };
    await this.save();
    return this.getSettings();
  }

  async setLanguage(language: Locale): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      language,
    };
    await this.save();
    return this.getSettings();
  }

  async setThemeMode(themeMode: ThemeMode): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      themeMode,
    };
    await this.save();
    return this.getSettings();
  }

  async setMonitorBindings(
    monitorBindings: MonitorBinding[],
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      monitorBindings,
    };
    await this.save();
    return this.getSettings();
  }

  async setMonitorAliases(
    monitorAliases: MonitorAlias[],
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      monitorAliases,
    };
    await this.save();
    return this.getSettings();
  }

  async setDefaultPresets(
    defaultPresets: DefaultPreset[],
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      defaultPresets,
    };
    await this.save();
    return this.getSettings();
  }

  async setRestartExplorerAfterApply(enabled: boolean): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      restartExplorerAfterApply: enabled,
    };
    await this.save();
    return this.getSettings();
  }

  async setProcessWatchIntervalMs(intervalMs: number): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      processWatchIntervalMs: normalizeProcessWatchIntervalMs(intervalMs),
    };
    await this.save();
    return this.getSettings();
  }

  async setPresets(presets: Preset[]): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      presets,
    };
    await this.save();
    return this.getSettings();
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(this.settings, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath);
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      // The app can still recover by writing a fresh settings file.
    }
  }
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  return {
    version: SETTINGS_VERSION,
    autostart: typeof value.autostart === "boolean" ? value.autostart : false,
    restartExplorerAfterApply:
      typeof value.restartExplorerAfterApply === "boolean"
        ? value.restartExplorerAfterApply
        : false,
    processWatchIntervalMs: normalizeProcessWatchIntervalMs(
      value.processWatchIntervalMs,
    ),
    language: isLocale(value.language) ? value.language : DEFAULT_LOCALE,
    themeMode: isThemeMode(value.themeMode)
      ? value.themeMode
      : DEFAULT_THEME_MODE,
    monitorBindings: Array.isArray(value.monitorBindings)
      ? value.monitorBindings.filter(isMonitorBinding)
      : [],
    monitorAliases: Array.isArray(value.monitorAliases)
      ? value.monitorAliases.filter(isMonitorAlias)
      : [],
    defaultPresets: Array.isArray(value.defaultPresets)
      ? value.defaultPresets.filter(isDefaultPreset)
      : [],
    presets: Array.isArray(value.presets)
      ? value.presets.map(normalizePreset).filter(isPreset)
      : [],
  };
}

function normalizeProcessWatchIntervalMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PROCESS_WATCH_INTERVAL_MS;
  }

  const intervalMs = Math.round(Number(value));
  return Math.min(
    Math.max(intervalMs, MIN_PROCESS_WATCH_INTERVAL_MS),
    MAX_PROCESS_WATCH_INTERVAL_MS,
  );
}

function isMonitorAlias(value: unknown): value is MonitorAlias {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.monitorId === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isMonitorBinding(value: unknown): value is MonitorBinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.deviceName === "string" &&
    typeof value.monitorId === "string" &&
    typeof value.monitorName === "string" &&
    typeof value.updatedAt === "string"
  );
}

function normalizePreset(value: unknown): Preset | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.monitorId !== "string" ||
    typeof value.monitorName !== "string" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    typeof value.refreshRate !== "number" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    monitorId: value.monitorId,
    monitorName: value.monitorName,
    width: value.width,
    height: value.height,
    refreshRate: value.refreshRate,
    processNames: normalizeProcessImageNames(value),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalizeProcessImageNames(value: Record<string, unknown>): string[] {
  const rawValues = Array.isArray(value.processNames)
    ? value.processNames
    : [value.processName];
  const processNames = new Set<string>();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const normalized = normalizeProcessImageName(rawValue);
    if (normalized.length > 0) {
      processNames.add(normalized);
    }
  }

  return Array.from(processNames);
}

function normalizeProcessImageName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const fileName = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const normalized = fileName.toLowerCase();
  return normalized.endsWith(".exe") ? normalized : `${normalized}.exe`;
}

function isPreset(value: Preset | null): value is Preset {
  return value !== null;
}

function isDefaultPreset(value: unknown): value is DefaultPreset {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.monitorId === "string" &&
    typeof value.presetId === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
