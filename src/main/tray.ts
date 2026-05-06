import {
  app,
  type BrowserWindow,
  type Tray as ElectronTray,
  Menu,
  type MenuItemConstructorOptions,
  type NativeImage,
  Notification,
  nativeImage,
  Tray,
} from "electron";
import { formatMode, type Locale, t } from "../shared/i18n";
import type {
  AppSettings,
  AppState,
  MonitorInfo,
  Preset,
} from "../shared/types";

export type TrayControllerOptions = {
  getState: () => AppState;
  showWindow: () => void;
  refreshMonitors: () => Promise<void>;
  applyPreset: (presetId: string) => Promise<void>;
  canApplyPreset: (presetId: string) => boolean;
  quit: () => void;
};

export class TrayController {
  private tray: ElectronTray | null = null;

  constructor(private readonly options: TrayControllerOptions) {}

  create(): void {
    if (this.tray !== null) {
      return;
    }

    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip("reschanger");
    this.tray.on("double-click", () => {
      this.options.showWindow();
    });
    this.rebuild();
  }

  rebuild(): void {
    if (this.tray === null) {
      return;
    }

    const state = this.options.getState();
    const locale = state.settings.language;
    const presetItems = buildMonitorPresetItems(
      state,
      locale,
      (presetId) => this.options.canApplyPreset(presetId),
      async (presetId) => {
        try {
          await this.options.applyPreset(presetId);
        } catch (error) {
          showTrayError(error, locale);
        }
      },
    );

    const menu = Menu.buildFromTemplate([
      {
        label: t(locale, "tray.openConfig"),
        click: () => this.options.showWindow(),
      },
      { type: "separator" },
      ...(presetItems.length > 0
        ? presetItems
        : [
            {
              label: t(locale, "tray.noPresets"),
              enabled: false,
            },
          ]),
      { type: "separator" },
      {
        label: t(locale, "action.refreshMonitors"),
        click: async () => {
          try {
            await this.options.refreshMonitors();
          } catch (error) {
            showTrayError(error, locale);
          }
        },
      },
      {
        label: t(locale, "tray.quit"),
        click: () => this.options.quit(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

export function attachWindowHideToTray(
  window: BrowserWindow,
  getShouldQuit: () => boolean,
): void {
  window.on("close", (event) => {
    if (getShouldQuit()) {
      return;
    }

    event.preventDefault();
    window.hide();
  });
}

function buildMonitorPresetItems(
  state: AppState,
  locale: Locale,
  canApplyPreset: (presetId: string) => boolean,
  applyPreset: (presetId: string) => Promise<void>,
): MenuItemConstructorOptions[] {
  const monitorItems = state.monitors
    .map((monitor, index) => {
      const presets = state.settings.presets.filter(
        (preset) => findMonitorForPreset(state, preset)?.id === monitor.id,
      );

      return {
        monitor,
        label: getMonitorDisplayName(locale, state.settings, monitor, index),
        sortOrder: getMonitorSortOrder(state.settings, monitor, index),
        submenu:
          presets.length > 0
            ? presets.map((preset) =>
                buildPresetMenuItem(preset, canApplyPreset, applyPreset),
              )
            : [
                {
                  label: t(locale, "tray.noMonitorPresets"),
                  enabled: false,
                },
              ],
      };
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.monitor.name.localeCompare(right.monitor.name),
    );

  const unavailablePresetItems = state.settings.presets
    .filter((preset) => findMonitorForPreset(state, preset) === null)
    .map((preset) => ({
      label: t(locale, "preset.trayLabel", {
        name: preset.name,
        monitorName: getPresetMonitorName(state, preset),
        mode: formatMode(preset.width, preset.height, preset.refreshRate),
      }),
      enabled: false,
    }));

  return [
    ...monitorItems.map(
      (item): MenuItemConstructorOptions => ({
        label: item.label,
        submenu: item.submenu,
      }),
    ),
    ...(unavailablePresetItems.length > 0
      ? [
          { type: "separator" as const },
          {
            label: t(locale, "preset.unavailableGroup"),
            submenu: unavailablePresetItems,
          },
        ]
      : []),
  ];
}

function buildPresetMenuItem(
  preset: Preset,
  canApplyPreset: (presetId: string) => boolean,
  applyPreset: (presetId: string) => Promise<void>,
): MenuItemConstructorOptions {
  return {
    label: `${preset.name} - ${formatMode(
      preset.width,
      preset.height,
      preset.refreshRate,
    )}`,
    enabled: canApplyPreset(preset.id),
    click: () => {
      void applyPreset(preset.id);
    },
  };
}

function getMonitorTitle(
  locale: Locale,
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): string {
  return t(locale, "monitor.groupTitle", {
    number: getMonitorSortOrder(settings, monitor, fallbackIndex),
  });
}

function getMonitorDisplayName(
  locale: Locale,
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): string {
  const alias = settings.monitorAliases.find(
    (item) => item.monitorId === monitor.id,
  );

  return (
    alias?.name.trim() ||
    getMonitorTitle(locale, settings, monitor, fallbackIndex)
  );
}

function getPresetMonitorName(state: AppState, preset: Preset): string {
  const monitor = findMonitorForPreset(state, preset);
  if (monitor) {
    const index = state.monitors.findIndex((item) => item.id === monitor.id);
    return getMonitorDisplayName(
      state.settings.language,
      state.settings,
      monitor,
      index >= 0 ? index : 0,
    );
  }

  const alias = state.settings.monitorAliases.find(
    (item) => item.monitorId === preset.monitorId,
  );

  return alias?.name.trim() || preset.monitorName;
}

function getMonitorSortOrder(
  settings: AppSettings,
  monitor: MonitorInfo,
  fallbackIndex: number,
): number {
  const rememberedBinding = settings.monitorBindings.find(
    (binding) => binding.monitorId === monitor.id,
  );
  const rememberedNumber = rememberedBinding
    ? parseDisplayNumber(rememberedBinding.deviceName)
    : null;

  return rememberedNumber ?? fallbackIndex + 1;
}

function findMonitorForPreset(
  state: AppState,
  preset: Preset,
): MonitorInfo | null {
  const exactMonitor =
    state.monitors.find((monitor) => monitor.id === preset.monitorId) ?? null;
  if (exactMonitor) {
    return exactMonitor;
  }

  const binding = state.settings.monitorBindings.find(
    (item) => item.deviceName === preset.monitorId,
  );
  if (binding) {
    const monitor = state.monitors.find(
      (item) => item.id === binding.monitorId,
    );
    if (monitor) {
      return monitor;
    }
  }

  return (
    state.monitors.find((monitor) => monitor.deviceName === preset.monitorId) ??
    null
  );
}

function parseDisplayNumber(deviceName: string): number | null {
  const match = /DISPLAY(\d+)$/i.exec(deviceName);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromBitmap(createIconBitmap(), {
    width: 16,
    height: 16,
    scaleFactor: 1,
  });

  image.setTemplateImage(false);
  return image;
}

function createIconBitmap(): Buffer {
  const width = 16;
  const height = 16;
  const buffer = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isBorder =
        x === 1 || x === width - 2 || y === 2 || y === height - 4;
      const isStand =
        (x >= 6 && x <= 9 && y >= 12) || (x >= 4 && x <= 11 && y === 14);
      const isScreen = x > 1 && x < width - 2 && y > 2 && y < height - 4;

      if (isBorder || isStand) {
        buffer[offset] = 245;
        buffer[offset + 1] = 247;
        buffer[offset + 2] = 250;
        buffer[offset + 3] = 255;
      } else if (isScreen) {
        buffer[offset] = 37;
        buffer[offset + 1] = 99;
        buffer[offset + 2] = 235;
        buffer[offset + 3] = 255;
      } else {
        buffer[offset] = 0;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 0;
        buffer[offset + 3] = 0;
      }
    }
  }

  return buffer;
}

function showTrayError(error: unknown, locale: Locale): void {
  const message =
    error instanceof Error ? error.message : t(locale, "error.unknown");

  if (Notification.isSupported()) {
    new Notification({
      title: "reschanger",
      body: message,
    }).show();
    return;
  }

  app.focus({ steal: true });
}
