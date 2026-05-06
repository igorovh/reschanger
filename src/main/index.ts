import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  formatMode,
  isLocale,
  isThemeMode,
  type Locale,
  type ThemeMode,
  t,
} from "../shared/i18n";
import type {
  AppErrorPayload,
  ApplyPresetResult,
  AppState,
  CreatePresetInput,
  MonitorBinding,
  MonitorInfo,
  Preset,
  UpdatePresetInput,
} from "../shared/types";
import { applyDisplayMode, listMonitors } from "./display/windowsDisplay";
import { SettingsStore } from "./store";
import { attachWindowHideToTray, TrayController } from "./tray";

let mainWindow: BrowserWindow | null = null;
let shouldQuit = false;
let store: SettingsStore;
let trayController: TrayController;
let monitors: MonitorInfo[] = [];

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    store = new SettingsStore();
    await store.load();
    syncAutostartWithSettings();
    await refreshMonitorsInternal(false);

    createMainWindow();
    trayController = new TrayController({
      getState,
      showWindow: showMainWindow,
      refreshMonitors: async () => refreshMonitorsInternal(true),
      applyPreset: applyPresetById,
      canApplyPreset: canApplyPresetById,
      quit: quitApp,
    });
    trayController.create();

    registerIpcHandlers();

    if (!process.argv.includes("--hidden")) {
      showMainWindow();
    }
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("before-quit", () => {
    shouldQuit = true;
  });

  app.on("window-all-closed", () => {
    // Keep the process alive so the tray menu continues to work.
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: "reschanger",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachWindowHideToTray(mainWindow, () => shouldQuit);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("state:get", () => getState());

  ipcMain.handle("monitors:refresh", async () => {
    await refreshMonitorsInternal(true);
    return getState();
  });

  ipcMain.handle("presets:create", async (_event, input: CreatePresetInput) => {
    const preset = buildPreset(input);
    await store.setPresets([...store.getSettings().presets, preset]);
    broadcastState();
    trayController.rebuild();
    return getState();
  });

  ipcMain.handle(
    "presets:update",
    async (_event, id: string, input: UpdatePresetInput) => {
      const settings = store.getSettings();
      const preset = settings.presets.find((item) => item.id === id);

      if (!preset) {
        throw new Error(t(currentLocale(), "error.presetUpdateMissing"));
      }

      const mergedInput: CreatePresetInput = {
        name: input.name ?? preset.name,
        monitorId: input.monitorId ?? preset.monitorId,
        width: input.width ?? preset.width,
        height: input.height ?? preset.height,
        refreshRate: input.refreshRate ?? preset.refreshRate,
      };

      const updatedPreset = {
        ...buildPreset(mergedInput, preset),
        id: preset.id,
        createdAt: preset.createdAt,
      };

      await store.setPresets(
        settings.presets.map((item) => (item.id === id ? updatedPreset : item)),
      );
      broadcastState();
      trayController.rebuild();
      return getState();
    },
  );

  ipcMain.handle("presets:delete", async (_event, id: string) => {
    const settings = store.getSettings();
    await store.setPresets(
      settings.presets.filter((preset) => preset.id !== id),
    );
    broadcastState();
    trayController.rebuild();
    return getState();
  });

  ipcMain.handle("presets:apply", async (_event, id: string) => {
    await applyPresetById(id);
    return getState();
  });

  ipcMain.handle("autostart:set", async (_event, enabled: boolean) => {
    setAutostart(enabled);
    await store.setAutostart(enabled);
    broadcastState();
    return getState();
  });

  ipcMain.handle("language:set", async (_event, language: Locale) => {
    if (!isLocale(language)) {
      throw new Error(t(currentLocale(), "error.unsupportedLanguage"));
    }

    await store.setLanguage(language);
    broadcastState();
    trayController.rebuild();
    return getState();
  });

  ipcMain.handle("theme:set", async (_event, themeMode: ThemeMode) => {
    if (!isThemeMode(themeMode)) {
      throw new Error(t(currentLocale(), "error.unsupportedThemeMode"));
    }

    await store.setThemeMode(themeMode);
    broadcastState();
    return getState();
  });
}

function getState(): AppState {
  return {
    settings: store.getSettings(),
    monitors,
  };
}

async function refreshMonitorsInternal(
  shouldNotifyRenderer: boolean,
): Promise<void> {
  try {
    const previousMonitorBindings = store.getSettings().monitorBindings;
    monitors = await listMonitors(currentLocale());
    await rememberMonitorBindings(monitors);
    await migrateLegacyPresetMonitorIds(previousMonitorBindings);
  } catch (error) {
    monitors = [];
    const payload = toAppError(
      t(currentLocale(), "error.refreshMonitorsFailed"),
      error,
    );
    sendAppError(payload);
  }

  trayController?.rebuild();

  if (shouldNotifyRenderer) {
    broadcastState();
  }
}

async function applyPresetById(id: string): Promise<void> {
  const preset = store.getSettings().presets.find((item) => item.id === id);

  if (!preset) {
    throw new Error(t(currentLocale(), "error.presetMissing"));
  }

  const monitor = findMonitorForPreset(preset);
  if (!monitor) {
    throw new Error(
      t(currentLocale(), "error.monitorUnavailable", { name: preset.name }),
    );
  }

  await applyDisplayMode(
    monitor.deviceName,
    preset.width,
    preset.height,
    preset.refreshRate,
    currentLocale(),
  );
  await refreshMonitorsInternal(false);
  trayController.rebuild();
  broadcastState();

  const result: ApplyPresetResult = {
    presetId: preset.id,
    presetName: preset.name,
    message: t(currentLocale(), "message.presetApplied", {
      mode: formatMode(preset.width, preset.height, preset.refreshRate),
      monitorName: preset.monitorName,
    }),
  };
  mainWindow?.webContents.send("preset:applied", result);
}

function canApplyPresetById(id: string): boolean {
  const preset = store.getSettings().presets.find((item) => item.id === id);
  return preset !== undefined && findMonitorForPreset(preset) !== null;
}

function buildPreset(input: CreatePresetInput, previous?: Preset): Preset {
  const monitor = monitors.find((item) => item.id === input.monitorId);
  if (!monitor) {
    throw new Error(t(currentLocale(), "error.selectCurrentMonitor"));
  }

  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error(t(currentLocale(), "error.presetNameRequired"));
  }

  validateMode(input.width, input.height, input.refreshRate);

  const now = new Date().toISOString();
  return {
    id: previous?.id ?? randomUUID(),
    name,
    monitorId: monitor.id,
    monitorName: monitor.name,
    width: input.width,
    height: input.height,
    refreshRate: input.refreshRate,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

async function rememberMonitorBindings(
  detectedMonitors: MonitorInfo[],
): Promise<void> {
  const settings = store.getSettings();
  const bindingsByDeviceName = new Map(
    settings.monitorBindings.map((binding) => [binding.deviceName, binding]),
  );
  let changed = false;
  const now = new Date().toISOString();

  for (const monitor of detectedMonitors) {
    if (bindingsByDeviceName.has(monitor.deviceName)) {
      continue;
    }

    bindingsByDeviceName.set(monitor.deviceName, {
      deviceName: monitor.deviceName,
      monitorId: monitor.id,
      monitorName: monitor.name,
      updatedAt: now,
    });
    changed = true;
  }

  if (!changed) {
    return;
  }

  await store.setMonitorBindings(
    Array.from(bindingsByDeviceName.values()).sort((left, right) =>
      left.deviceName.localeCompare(right.deviceName),
    ),
  );
}

async function migrateLegacyPresetMonitorIds(
  previousMonitorBindings: MonitorBinding[],
): Promise<void> {
  if (previousMonitorBindings.length === 0) {
    return;
  }

  const settings = store.getSettings();
  const now = new Date().toISOString();
  let changed = false;
  const migratedPresets = settings.presets.map((preset) => {
    if (!isLegacyDisplayDeviceName(preset.monitorId)) {
      return preset;
    }

    const monitor = findMonitorByLegacyDeviceName(
      preset.monitorId,
      previousMonitorBindings,
    );
    if (!monitor) {
      return preset;
    }

    changed = true;
    return {
      ...preset,
      monitorId: monitor.id,
      monitorName: monitor.name,
      updatedAt: now,
    };
  });

  if (changed) {
    await store.setPresets(migratedPresets);
  }
}

function findMonitorForPreset(preset: Preset): MonitorInfo | null {
  const exactMonitor = monitors.find((item) => item.id === preset.monitorId);
  if (exactMonitor) {
    return exactMonitor;
  }

  if (!isLegacyDisplayDeviceName(preset.monitorId)) {
    return null;
  }

  return (
    findMonitorByLegacyDeviceName(
      preset.monitorId,
      store.getSettings().monitorBindings,
    ) ??
    monitors.find((item) => item.deviceName === preset.monitorId) ??
    null
  );
}

function findMonitorByLegacyDeviceName(
  deviceName: string,
  bindings: MonitorBinding[],
): MonitorInfo | null {
  for (const binding of bindings) {
    if (binding.deviceName !== deviceName) {
      continue;
    }

    const monitor = monitors.find((item) => item.id === binding.monitorId);
    if (monitor) {
      return monitor;
    }
  }

  return null;
}

function isLegacyDisplayDeviceName(value: string): boolean {
  return /^\\\\\.\\DISPLAY\d+$/i.test(value);
}

function validateMode(
  width: number,
  height: number,
  refreshRate: number,
): void {
  if (!Number.isInteger(width) || width < 640 || width > 10000) {
    throw new Error(t(currentLocale(), "error.widthInvalid"));
  }

  if (!Number.isInteger(height) || height < 480 || height > 10000) {
    throw new Error(t(currentLocale(), "error.heightInvalid"));
  }

  if (
    !Number.isInteger(refreshRate) ||
    refreshRate < 30 ||
    refreshRate > 1000
  ) {
    throw new Error(t(currentLocale(), "error.refreshRateInvalid"));
  }
}

function showMainWindow(): void {
  if (mainWindow === null) {
    createMainWindow();
  }

  mainWindow?.show();
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow?.focus();
}

function quitApp(): void {
  shouldQuit = true;
  trayController?.destroy();
  app.quit();
}

function syncAutostartWithSettings(): void {
  setAutostart(store.getSettings().autostart);
}

function setAutostart(enabled: boolean): void {
  const args = app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"];

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args,
  });
}

function broadcastState(): void {
  mainWindow?.webContents.send("state:changed", getState());
}

function currentLocale(): Locale {
  return store.getSettings().language;
}

function sendAppError(payload: AppErrorPayload): void {
  mainWindow?.webContents.send("app:error", payload);

  if (!mainWindow?.isVisible()) {
    void dialog.showErrorBox(payload.title, payload.message);
  }
}

function toAppError(title: string, error: unknown): AppErrorPayload {
  return {
    title,
    message:
      error instanceof Error
        ? error.message
        : t(currentLocale(), "error.unknown"),
  };
}
