import {
  app,
  type BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  Tray,
} from "electron";
import { formatMode, type Locale, t } from "../shared/i18n";
import type { AppState } from "../shared/types";

export type TrayControllerOptions = {
  getState: () => AppState;
  showWindow: () => void;
  refreshMonitors: () => Promise<void>;
  applyPreset: (presetId: string) => Promise<void>;
  canApplyPreset: (presetId: string) => boolean;
  quit: () => void;
};

export class TrayController {
  private tray: Tray | null = null;

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
    const presetItems = state.settings.presets.map((preset) => ({
      label: t(locale, "preset.trayLabel", {
        name: preset.name,
        monitorName: preset.monitorName,
        mode: formatMode(preset.width, preset.height, preset.refreshRate),
      }),
      enabled: this.options.canApplyPreset(preset.id),
      click: async () => {
        try {
          await this.options.applyPreset(preset.id);
        } catch (error) {
          showTrayError(error, locale);
        }
      },
    }));

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

function createTrayIcon(): Electron.NativeImage {
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
