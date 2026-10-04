import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
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
  SetDefaultPresetInput,
  SetMonitorAliasInput,
  SetProcessWatchIntervalInput,
  UpdatePresetInput,
} from "../shared/types";
import {
  MAX_PROCESS_WATCH_INTERVAL_MS,
  MIN_PROCESS_WATCH_INTERVAL_MS,
} from "../shared/types";
import { applyDisplayMode, listMonitors } from "./display/windowsDisplay";
import { SettingsStore } from "./store";
import { attachWindowHideToTray, createAppIcon, TrayController } from "./tray";

let mainWindow: BrowserWindow | null = null;
let shouldQuit = false;
let store: SettingsStore;
let trayController: TrayController;
let monitors: MonitorInfo[] = [];
let explorerRestartTimer: ReturnType<typeof setTimeout> | null = null;
let processWatchTimer: ReturnType<typeof setInterval> | null = null;
let processWatchInFlight = false;
let processWatchLastErrorAt = 0;
const activeProcessPresetIds = new Set<string>();

const EXPLORER_RESTART_DELAY_MS = 3000;
const PROCESS_WATCH_ERROR_THROTTLE_MS = 60000;

type PresetApplication = {
  preset: Preset;
  monitor: MonitorInfo;
};

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    store = new SettingsStore();
    await store.load();
    syncAutostartWithSettings();
    await refreshMonitorsInternal(false);
    await reconcileDefaultPresets();

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
    startProcessWatcher();

    if (!process.argv.includes("--hidden")) {
      showMainWindow();
    }
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("before-quit", () => {
    shouldQuit = true;
    clearScheduledExplorerRestart();
    stopProcessWatcher();
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
    icon: createAppIcon(32),
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);

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
    if (input.isDefault === true) {
      await setDefaultPreset({ presetId: preset.id });
    }
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
        processNames: input.processNames ?? preset.processNames,
      };

      const updatedPreset = {
        ...buildPreset(mergedInput, preset),
        id: preset.id,
        createdAt: preset.createdAt,
      };

      await store.setPresets(
        settings.presets.map((item) => (item.id === id ? updatedPreset : item)),
      );
      if (input.isDefault === true) {
        await setDefaultPreset({ presetId: updatedPreset.id });
      } else if (input.isDefault === false) {
        await unsetDefaultPresetForPreset(updatedPreset.id);
      }
      await reconcileDefaultPresets();
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
    await store.setDefaultPresets(
      settings.defaultPresets.filter((preset) => preset.presetId !== id),
    );
    activeProcessPresetIds.delete(id);
    broadcastState();
    trayController.rebuild();
    return getState();
  });

  ipcMain.handle("presets:apply", async (_event, id: string) => {
    await applyPresetById(id);
    return getState();
  });

  ipcMain.handle(
    "presets:default:set",
    async (_event, input: SetDefaultPresetInput) => {
      await setDefaultPreset(input);
      broadcastState();
      trayController.rebuild();
      return getState();
    },
  );

  ipcMain.handle(
    "monitors:alias:set",
    async (_event, input: SetMonitorAliasInput) => {
      await setMonitorAlias(input);
      broadcastState();
      trayController.rebuild();
      return getState();
    },
  );

  ipcMain.handle("autostart:set", async (_event, enabled: boolean) => {
    setAutostart(enabled);
    await store.setAutostart(enabled);
    broadcastState();
    return getState();
  });

  ipcMain.handle("explorer-restart:set", async (_event, enabled: boolean) => {
    if (!enabled) {
      clearScheduledExplorerRestart();
    }

    await store.setRestartExplorerAfterApply(enabled);
    broadcastState();
    return getState();
  });

  ipcMain.handle(
    "process-watch-interval:set",
    async (_event, input: SetProcessWatchIntervalInput) => {
      const intervalMs = validateProcessWatchIntervalMs(input.intervalMs);
      await store.setProcessWatchIntervalMs(intervalMs);
      rescheduleProcessWatcher();
      broadcastState();
      return getState();
    },
  );

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
    monitors = await listMonitors(currentLocale());
    await rememberMonitorBindings(monitors);
    await migrateLegacyPresetMonitorIds(store.getSettings().monitorBindings);
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
  await applyPresetBatch([id]);
}

async function applyPresetBatch(ids: Iterable<string>): Promise<void> {
  const settings = store.getSettings();
  const applicationsByMonitorId = new Map<string, PresetApplication>();

  for (const id of ids) {
    const preset = settings.presets.find((item) => item.id === id);

    if (!preset) {
      throw new Error(t(currentLocale(), "error.presetMissing"));
    }

    const monitor = findMonitorForPreset(preset);
    if (!monitor) {
      throw new Error(
        t(currentLocale(), "error.monitorUnavailable", { name: preset.name }),
      );
    }

    applicationsByMonitorId.set(preset.monitorId, { preset, monitor });
  }

  const applications = Array.from(applicationsByMonitorId.values());
  if (applications.length === 0) {
    return;
  }

  for (const { preset, monitor } of applications) {
    await applyDisplayMode(
      monitor.deviceName,
      preset.width,
      preset.height,
      preset.refreshRate,
      currentLocale(),
    );
  }

  scheduleExplorerRestartAfterApply();
  await refreshMonitorsInternal(false);
  trayController.rebuild();
  broadcastState();

  for (const { preset, monitor } of applications) {
    const result: ApplyPresetResult = {
      presetId: preset.id,
      presetName: preset.name,
      message: t(currentLocale(), "message.presetApplied", {
        mode: formatMode(preset.width, preset.height, preset.refreshRate),
        monitorName: getMonitorDisplayName(monitor),
      }),
    };
    mainWindow?.webContents.send("preset:applied", result);
  }
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
    monitorName: getMonitorDisplayName(monitor),
    width: input.width,
    height: input.height,
    refreshRate: input.refreshRate,
    processNames: normalizeProcessImageNames(input.processNames ?? []),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

async function setDefaultPreset(input: SetDefaultPresetInput): Promise<void> {
  const settings = store.getSettings();
  const preset = settings.presets.find((item) => item.id === input.presetId);

  if (!preset) {
    throw new Error(t(currentLocale(), "error.presetMissing"));
  }

  const now = new Date().toISOString();
  await store.setDefaultPresets([
    ...settings.defaultPresets.filter(
      (item) => item.monitorId !== preset.monitorId,
    ),
    {
      monitorId: preset.monitorId,
      presetId: preset.id,
      updatedAt: now,
    },
  ]);
}

async function unsetDefaultPresetForPreset(presetId: string): Promise<void> {
  const settings = store.getSettings();
  await store.setDefaultPresets(
    settings.defaultPresets.filter((item) => item.presetId !== presetId),
  );
}

async function setMonitorAlias(input: SetMonitorAliasInput): Promise<void> {
  const monitor = monitors.find((item) => item.id === input.monitorId);
  if (!monitor) {
    throw new Error(t(currentLocale(), "error.selectCurrentMonitor"));
  }

  const settings = store.getSettings();
  const name = input.name.trim();
  const nextAliases =
    name.length > 0
      ? [
          ...settings.monitorAliases.filter(
            (alias) => alias.monitorId !== monitor.id,
          ),
          {
            monitorId: monitor.id,
            name,
            updatedAt: new Date().toISOString(),
          },
        ]
      : settings.monitorAliases.filter(
          (alias) => alias.monitorId !== monitor.id,
        );

  await store.setMonitorAliases(nextAliases);
}

function getMonitorDisplayName(monitor: MonitorInfo): string {
  const alias = store
    .getSettings()
    .monitorAliases.find((item) => item.monitorId === monitor.id);

  return (
    alias?.name.trim() ||
    t(currentLocale(), "monitor.groupTitle", {
      number: getMonitorSortOrder(monitor),
    })
  );
}

function getMonitorSortOrder(monitor: MonitorInfo): number {
  const settings = store.getSettings();
  const rememberedBinding = settings.monitorBindings.find(
    (binding) => binding.monitorId === monitor.id,
  );
  const rememberedNumber = rememberedBinding
    ? parseDisplayNumber(rememberedBinding.deviceName)
    : null;
  const fallbackIndex = monitors.findIndex((item) => item.id === monitor.id);

  return rememberedNumber ?? (fallbackIndex >= 0 ? fallbackIndex + 1 : 1);
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
  bindings: MonitorBinding[],
): Promise<void> {
  if (bindings.length === 0) {
    return;
  }

  const settings = store.getSettings();
  const now = new Date().toISOString();
  let changed = false;
  const migratedPresets = settings.presets.map((preset) => {
    if (!isLegacyDisplayDeviceName(preset.monitorId)) {
      return preset;
    }

    const monitor = findMonitorByLegacyDeviceName(preset.monitorId, bindings);
    if (!monitor) {
      return preset;
    }

    changed = true;
    return {
      ...preset,
      monitorId: monitor.id,
      monitorName: getMonitorDisplayName(monitor),
      updatedAt: now,
    };
  });

  if (changed) {
    await store.setPresets(migratedPresets);
    await reconcileDefaultPresets();
  }
}

async function reconcileDefaultPresets(): Promise<void> {
  const settings = store.getSettings();
  const nextDefaults: typeof settings.defaultPresets = [];
  const usedMonitorIds = new Set<string>();

  for (const defaultPreset of settings.defaultPresets) {
    const preset = settings.presets.find(
      (item) => item.id === defaultPreset.presetId,
    );

    if (!preset || usedMonitorIds.has(preset.monitorId)) {
      continue;
    }

    usedMonitorIds.add(preset.monitorId);
    nextDefaults.push({
      ...defaultPreset,
      monitorId: preset.monitorId,
    });
  }

  if (
    nextDefaults.length === settings.defaultPresets.length &&
    nextDefaults.every(
      (item, index) =>
        item.monitorId === settings.defaultPresets[index]?.monitorId &&
        item.presetId === settings.defaultPresets[index]?.presetId,
    )
  ) {
    return;
  }

  await store.setDefaultPresets(nextDefaults);
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

function parseDisplayNumber(deviceName: string): number | null {
  const match = /DISPLAY(\d+)$/i.exec(deviceName);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
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

function startProcessWatcher(): void {
  if (process.platform !== "win32" || processWatchTimer !== null) {
    return;
  }

  void evaluateProcessRules();
  scheduleProcessWatcherTimer();
}

function scheduleProcessWatcherTimer(): void {
  if (process.platform !== "win32") {
    return;
  }

  clearProcessWatcherTimer();
  processWatchTimer = setInterval(() => {
    void evaluateProcessRules();
  }, store.getSettings().processWatchIntervalMs);
}

function rescheduleProcessWatcher(): void {
  if (processWatchTimer === null) {
    return;
  }

  scheduleProcessWatcherTimer();
}

function stopProcessWatcher(): void {
  clearProcessWatcherTimer();
  activeProcessPresetIds.clear();
}

function clearProcessWatcherTimer(): void {
  if (processWatchTimer === null) {
    return;
  }

  clearInterval(processWatchTimer);
  processWatchTimer = null;
}

async function evaluateProcessRules(): Promise<void> {
  if (processWatchInFlight) {
    return;
  }

  processWatchInFlight = true;

  try {
    const runningProcessNames = await listRunningProcessNames();
    const settings = store.getSettings();
    const processPresets = settings.presets.filter(
      (preset) => preset.processNames.length > 0,
    );
    const processPresetIds = new Set(processPresets.map((preset) => preset.id));
    const changedMonitorIds = new Set<string>();

    for (const presetId of Array.from(activeProcessPresetIds)) {
      if (!processPresetIds.has(presetId)) {
        const preset = settings.presets.find((item) => item.id === presetId);
        if (preset) {
          changedMonitorIds.add(preset.monitorId);
        }
        activeProcessPresetIds.delete(presetId);
      }
    }

    for (const preset of processPresets) {
      const isRunning = preset.processNames.some((processName) =>
        runningProcessNames.has(normalizeProcessImageName(processName)),
      );
      const isActive = activeProcessPresetIds.has(preset.id);

      if (isRunning && !isActive) {
        activeProcessPresetIds.add(preset.id);
        changedMonitorIds.add(preset.monitorId);
        continue;
      }

      if (!isRunning && isActive) {
        activeProcessPresetIds.delete(preset.id);
        changedMonitorIds.add(preset.monitorId);
      }
    }

    const targetPresetIdsByMonitor = new Map<string, string>();
    for (const monitorId of changedMonitorIds) {
      const targetPreset =
        findActiveProcessPresetForMonitor(monitorId, processPresets) ??
        findDefaultPresetForMonitor(monitorId);

      if (targetPreset) {
        targetPresetIdsByMonitor.set(monitorId, targetPreset.id);
      }
    }

    await applyPresetBatch(targetPresetIdsByMonitor.values());
  } catch (error) {
    const now = Date.now();
    if (now - processWatchLastErrorAt > PROCESS_WATCH_ERROR_THROTTLE_MS) {
      processWatchLastErrorAt = now;
      sendAppError(
        toAppError(t(currentLocale(), "error.processWatchFailed"), error),
      );
    }
  } finally {
    processWatchInFlight = false;
  }
}

function findActiveProcessPresetForMonitor(
  monitorId: string,
  processPresets: Preset[],
): Preset | null {
  const processPresetById = new Map(
    processPresets.map((preset) => [preset.id, preset]),
  );
  let targetPreset: Preset | null = null;

  for (const presetId of activeProcessPresetIds) {
    const preset = processPresetById.get(presetId);
    if (preset?.monitorId === monitorId) {
      targetPreset = preset;
    }
  }

  return targetPreset;
}

function findDefaultPresetForMonitor(monitorId: string): Preset | null {
  const settings = store.getSettings();
  const defaultPreset = settings.defaultPresets.find(
    (item) => item.monitorId === monitorId,
  );

  if (!defaultPreset) {
    return null;
  }

  return (
    settings.presets.find((preset) => preset.id === defaultPreset.presetId) ??
    null
  );
}

async function listRunningProcessNames(): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const child = spawn("tasklist.exe", ["/fo", "csv", "/nh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `tasklist.exe exited with ${code}`));
        return;
      }

      resolve(
        new Set(
          stdout
            .split(/\r?\n/)
            .map(parseTasklistImageName)
            .filter((name): name is string => name !== null)
            .map(normalizeProcessImageName),
        ),
      );
    });
  });
}

function parseTasklistImageName(line: string): string | null {
  const match = /^"((?:[^"]|"")*)"/.exec(line.trim());
  return match?.[1]?.replace(/""/g, '"') ?? null;
}

function normalizeProcessImageNames(values: string[]): string[] {
  const processNames = new Set<string>();

  for (const value of values) {
    const normalized = normalizeProcessImageName(value);
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

function validateProcessWatchIntervalMs(intervalMs: unknown): number {
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs)) {
    throw new Error(t(currentLocale(), "error.processWatchIntervalInvalid"));
  }

  const normalizedIntervalMs = Math.round(Number(intervalMs));
  if (
    normalizedIntervalMs < MIN_PROCESS_WATCH_INTERVAL_MS ||
    normalizedIntervalMs > MAX_PROCESS_WATCH_INTERVAL_MS
  ) {
    throw new Error(
      t(currentLocale(), "error.processWatchIntervalInvalidRange", {
        min: MIN_PROCESS_WATCH_INTERVAL_MS / 1000,
        max: MAX_PROCESS_WATCH_INTERVAL_MS / 1000,
      }),
    );
  }

  return normalizedIntervalMs;
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

function scheduleExplorerRestartAfterApply(): void {
  if (
    process.platform !== "win32" ||
    !store.getSettings().restartExplorerAfterApply
  ) {
    return;
  }

  clearScheduledExplorerRestart();
  explorerRestartTimer = setTimeout(() => {
    explorerRestartTimer = null;

    if (store.getSettings().restartExplorerAfterApply) {
      restartExplorer();
    }
  }, EXPLORER_RESTART_DELAY_MS);
}

function clearScheduledExplorerRestart(): void {
  if (explorerRestartTimer === null) {
    return;
  }

  clearTimeout(explorerRestartTimer);
  explorerRestartTimer = null;
}

function restartExplorer(): void {
  let explorerStarted = false;
  const startOnce = () => {
    if (explorerStarted) {
      return;
    }

    explorerStarted = true;
    startExplorer();
  };

  try {
    const taskkill = spawn("taskkill", ["/f", "/im", "explorer.exe"], {
      stdio: "ignore",
      windowsHide: true,
    });

    taskkill.once("error", startOnce);
    taskkill.once("close", startOnce);
    taskkill.unref();
  } catch {
    startOnce();
  }
}

function startExplorer(): void {
  try {
    const explorer = spawn("explorer.exe", [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    explorer.once("error", () => {});
    explorer.unref();
  } catch {
    // Resolution changes should not fail because Explorer could not restart.
  }
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
