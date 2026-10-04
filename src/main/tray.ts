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

    this.tray = new Tray(createAppIcon(16));
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

export function createAppIcon(size: number): NativeImage {
  const svgImage = nativeImage
    .createFromDataURL(createLogoSvgDataUrl(size))
    .resize({ width: size, height: size, quality: "best" });

  const image = svgImage.isEmpty()
    ? nativeImage.createFromBitmap(createLogoBitmap(size), {
        width: size,
        height: size,
        scaleFactor: 1,
      })
    : svgImage;

  image.setTemplateImage(false);
  return image;
}

function createLogoSvgDataUrl(size: number): string {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="reschanger expand frame logo"><g fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="27" y="31" width="46" height="38" rx="6"/><path d="M 23 70 L 23 77 L 30 77"/><path d="M 77 30 L 77 23 L 70 23"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createLogoBitmap(size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4);
  const strokeWidth = Math.max(1, Math.round(size * 0.06));
  const color: [number, number, number, number] = [37, 99, 235, 255];

  drawRect(buffer, size, 27, 31, 73, 69, strokeWidth, color);
  drawLine(buffer, size, 23, 70, 23, 77, strokeWidth, color);
  drawLine(buffer, size, 23, 77, 30, 77, strokeWidth, color);
  drawLine(buffer, size, 77, 30, 77, 23, strokeWidth, color);
  drawLine(buffer, size, 77, 23, 70, 23, strokeWidth, color);
  return buffer;
}

function drawRect(
  buffer: Buffer,
  size: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  strokeWidth: number,
  color: [number, number, number, number],
): void {
  drawLine(buffer, size, left, top, right, top, strokeWidth, color);
  drawLine(buffer, size, right, top, right, bottom, strokeWidth, color);
  drawLine(buffer, size, right, bottom, left, bottom, strokeWidth, color);
  drawLine(buffer, size, left, bottom, left, top, strokeWidth, color);
}

function drawLine(
  buffer: Buffer,
  size: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  strokeWidth: number,
  color: [number, number, number, number],
): void {
  const x1 = scaleLogoCoordinate(startX, size);
  const y1 = scaleLogoCoordinate(startY, size);
  const x2 = scaleLogoCoordinate(endX, size);
  const y2 = scaleLogoCoordinate(endY, size);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / steps);
    const y = Math.round(y1 + ((y2 - y1) * step) / steps);
    drawPoint(buffer, size, x, y, strokeWidth, color);
  }
}

function drawPoint(
  buffer: Buffer,
  size: number,
  centerX: number,
  centerY: number,
  strokeWidth: number,
  color: [number, number, number, number],
): void {
  const radius = Math.floor(strokeWidth / 2);

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || x >= size || y < 0 || y >= size) {
        continue;
      }

      const offset = (y * size + x) * 4;
      buffer[offset] = color[0];
      buffer[offset + 1] = color[1];
      buffer[offset + 2] = color[2];
      buffer[offset + 3] = color[3];
    }
  }
}

function scaleLogoCoordinate(value: number, size: number): number {
  return Math.round((value / 100) * (size - 1));
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
