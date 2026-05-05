import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { AppSettings, Preset } from "../shared/types";

const SETTINGS_VERSION = 1;

const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  autostart: false,
  presets: []
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
      autostart: enabled
    };
    await this.save();
    return this.getSettings();
  }

  async setPresets(presets: Preset[]): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      presets
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
      "utf8"
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
    presets: Array.isArray(value.presets) ? value.presets.filter(isPreset) : []
  };
}

function isPreset(value: unknown): value is Preset {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.monitorId === "string" &&
    typeof value.monitorName === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.refreshRate === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
