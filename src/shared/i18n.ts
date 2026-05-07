export const LOCALES = ["pl", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pl";

export const THEME_MODES = ["auto", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "auto";

const TRANSLATIONS = {
  pl: {
    "app.subtitle":
      "Szybka zmiana rozdzielczości i odświeżania z zasobnika systemowego.",
    "action.apply": "Zastosuj",
    "action.cancel": "Anuluj",
    "action.delete": "Usuń",
    "action.edit": "Edytuj",
    "action.refreshMonitors": "Odśwież monitory",
    "action.reset": "Resetuj",
    "action.save": "Zapisz",
    "action.saveChanges": "Zapisz zmiany",
    "action.addPreset": "Dodaj preset",
    "action.setDefault": "Ustaw jako domyślny",
    "autostart.label": "Autostart z Windows",
    "autostart.enabled": "Włączono autostart.",
    "autostart.disabled": "Wyłączono autostart.",
    "explorerRestart.label": "Restartuj explorer.exe po zmianie rozdzielczości",
    "explorerRestart.enabled": "Włączono restart explorer.exe po zmianie.",
    "explorerRestart.disabled": "Wyłączono restart explorer.exe po zmianie.",
    "empty.noMonitors": "Brak wykrytych monitorów",
    "empty.noPresets": "Brak zapisanych presetów.",
    "field.height": "Wysokość",
    "field.language": "Język",
    "field.monitor": "Monitor",
    "field.monitorAlias": "Nazwa w aplikacji",
    "field.name": "Nazwa",
    "field.processName": "Proces",
    "field.themeMode": "Mode",
    "field.refreshRate": "Odświeżanie",
    "field.resolution": "Rozdzielczość",
    "field.width": "Szerokość",
    "form.currentMode": "Aktualnie: {mode}",
    "form.editPreset": "Edytuj preset",
    "form.manualMode": "Wpisz tryb ręcznie",
    "form.newPreset": "Nowy preset",
    "form.processPlaceholder": "cs2.exe",
    "language.en": "English",
    "language.pl": "Polski",
    "monitor.groupTitle": "Monitor {number}",
    "notice.loadingSettings": "Ładowanie ustawień...",
    "notice.ready": "Gotowe.",
    "notice.monitorsRefreshed": "Odświeżono monitory.",
    "notice.monitorAliasReset": "Zresetowano nazwę monitora.",
    "notice.monitorAliasSaved": "Zapisano nazwę monitora.",
    "notice.defaultPresetSaved": 'Ustawiono "{name}" jako domyślny preset.',
    "notice.presetApplied": 'Zastosowano preset "{name}".',
    "notice.presetDeleted": 'Usunięto preset "{name}".',
    "notice.presetSaved": "Zapisano preset.",
    "notice.presetUpdated": "Zapisano zmiany presetu.",
    "preset.defaultName": "Opcja {number}",
    "preset.defaultBadge": "Domyślny",
    "preset.defaultSelected": "Preset domyślny",
    "preset.monitorUnavailable": "Monitor niedostępny",
    "preset.noMonitorPresets": "Brak presetów dla tego monitora.",
    "preset.savedPresets": "Zapisane presety",
    "preset.processTrigger": "Proces: {processName}",
    "preset.trayLabel": "{name} - {monitorName} - {mode}",
    "preset.unavailableGroup": "Niedostępne monitory",
    "processWatchInterval.label": "Sprawdzanie procesów co (s)",
    "processWatchInterval.updated":
      "Zaktualizowano interwał sprawdzania procesów.",
    "settings.open": "Ustawienia",
    "settings.advanced": "Zaawansowane",
    "settings.updated": "Zaktualizowano ustawienia.",
    "settings.title": "Ustawienia",
    "theme.auto": "Auto",
    "theme.dark": "Dark Mode",
    "theme.light": "Light Mode",
    "tray.noPresets": "Brak zapisanych presetów",
    "tray.noMonitorPresets": "Brak presetów dla tego monitora",
    "tray.openConfig": "Otwórz konfigurację",
    "tray.quit": "Zakończ",
    "validation.completePreset":
      "Uzupełnij nazwę, monitor, rozdzielczość i Hz.",
    "error.monitorUnavailable":
      'Monitor przypisany do presetu "{name}" nie jest obecnie dostępny.',
    "error.presetMissing": "Nie znaleziono presetu.",
    "error.presetUpdateMissing": "Nie znaleziono presetu do aktualizacji.",
    "error.refreshMonitorsFailed": "Nie udało się odświeżyć monitorów.",
    "error.selectCurrentMonitor": "Wybierz monitor z aktualnie wykrytej listy.",
    "error.unsupportedLanguage": "Nieobsługiwany język.",
    "error.unsupportedThemeMode": "Nieobsługiwany tryb wyglądu.",
    "error.unknown": "Wystąpił nieznany błąd.",
    "error.presetNameRequired": "Nazwa presetu nie może być pusta.",
    "error.processWatchFailed":
      "Nie udało się sprawdzić uruchomionych procesów.",
    "error.processWatchIntervalInvalid":
      "Interwał sprawdzania procesów musi być liczbą.",
    "error.processWatchIntervalInvalidRange":
      "Interwał sprawdzania procesów musi być z zakresu {min}-{max} s.",
    "error.widthInvalid":
      "Szerokość musi być liczbą całkowitą z zakresu 640-10000.",
    "error.heightInvalid":
      "Wysokość musi być liczbą całkowitą z zakresu 480-10000.",
    "error.refreshRateInvalid":
      "Odświeżanie musi być liczbą całkowitą z zakresu 30-1000 Hz.",
    "message.presetApplied": "Zastosowano {mode} dla {monitorName}.",
    "display.applyFailed":
      "Nie udało się zastosować trybu {mode}. Kod Windows: {code}.",
    "display.emptyPowerShell": "PowerShell nie zwrócił wyniku.",
    "display.listFailed": "Nie udało się pobrać listy monitorów.",
    "display.missingMonitorId": "Brak identyfikatora monitora.",
    "display.powerShellFailed": "PowerShell zakończył pracę z kodem {code}.",
    "display.readCurrentFailed":
      "Nie można odczytać bieżącego trybu monitora {deviceName}.",
    "display.testRejected":
      "Windows odrzucił test trybu {mode}. Kod Windows: {code}.",
    "display.windowsOnly":
      "Zmiana rozdzielczości jest obsługiwana tylko w systemie Windows.",
  },
  en: {
    "app.subtitle":
      "Quickly change resolution and refresh rate from the system tray.",
    "action.apply": "Apply",
    "action.cancel": "Cancel",
    "action.delete": "Delete",
    "action.edit": "Edit",
    "action.refreshMonitors": "Refresh monitors",
    "action.reset": "Reset",
    "action.save": "Save",
    "action.saveChanges": "Save changes",
    "action.addPreset": "Add preset",
    "action.setDefault": "Set as default",
    "autostart.label": "Start with Windows",
    "autostart.enabled": "Autostart enabled.",
    "autostart.disabled": "Autostart disabled.",
    "explorerRestart.label": "Restart explorer.exe after resolution change",
    "explorerRestart.enabled": "Explorer restart after changes enabled.",
    "explorerRestart.disabled": "Explorer restart after changes disabled.",
    "empty.noMonitors": "No monitors detected",
    "empty.noPresets": "No saved presets.",
    "field.height": "Height",
    "field.language": "Language",
    "field.monitor": "Monitor",
    "field.monitorAlias": "Monitor alias",
    "field.name": "Name",
    "field.processName": "Process",
    "field.themeMode": "Mode",
    "field.refreshRate": "Refresh rate",
    "field.resolution": "Resolution",
    "field.width": "Width",
    "form.currentMode": "Current: {mode}",
    "form.editPreset": "Edit preset",
    "form.manualMode": "Enter mode manually",
    "form.newPreset": "New preset",
    "form.processPlaceholder": "cs2.exe",
    "language.en": "English",
    "language.pl": "Polski",
    "monitor.groupTitle": "Monitor {number}",
    "notice.loadingSettings": "Loading settings...",
    "notice.ready": "Ready.",
    "notice.monitorsRefreshed": "Monitors refreshed.",
    "notice.monitorAliasReset": "Monitor name reset.",
    "notice.monitorAliasSaved": "Monitor name saved.",
    "notice.defaultPresetSaved": 'Set "{name}" as the default preset.',
    "notice.presetApplied": 'Applied preset "{name}".',
    "notice.presetDeleted": 'Deleted preset "{name}".',
    "notice.presetSaved": "Preset saved.",
    "notice.presetUpdated": "Preset changes saved.",
    "preset.defaultName": "Option {number}",
    "preset.defaultBadge": "Default",
    "preset.defaultSelected": "Default preset",
    "preset.monitorUnavailable": "Monitor unavailable",
    "preset.noMonitorPresets": "No presets for this monitor.",
    "preset.savedPresets": "Saved presets",
    "preset.processTrigger": "Process: {processName}",
    "preset.trayLabel": "{name} - {monitorName} - {mode}",
    "preset.unavailableGroup": "Unavailable monitors",
    "processWatchInterval.label": "Check processes every (s)",
    "processWatchInterval.updated": "Process check interval updated.",
    "settings.open": "Settings",
    "settings.advanced": "Advanced",
    "settings.updated": "Settings updated.",
    "settings.title": "Settings",
    "theme.auto": "Auto",
    "theme.dark": "Dark Mode",
    "theme.light": "Light Mode",
    "tray.noPresets": "No saved presets",
    "tray.noMonitorPresets": "No presets for this monitor",
    "tray.openConfig": "Open configuration",
    "tray.quit": "Quit",
    "validation.completePreset": "Fill in name, monitor, resolution and Hz.",
    "error.monitorUnavailable":
      'The monitor assigned to preset "{name}" is not currently available.',
    "error.presetMissing": "Preset not found.",
    "error.presetUpdateMissing": "Preset to update was not found.",
    "error.refreshMonitorsFailed": "Could not refresh monitors.",
    "error.selectCurrentMonitor":
      "Choose a monitor from the currently detected list.",
    "error.unsupportedLanguage": "Unsupported language.",
    "error.unsupportedThemeMode": "Unsupported theme mode.",
    "error.unknown": "An unknown error occurred.",
    "error.presetNameRequired": "Preset name cannot be empty.",
    "error.processWatchFailed": "Could not check running processes.",
    "error.processWatchIntervalInvalid":
      "Process check interval must be a number.",
    "error.processWatchIntervalInvalidRange":
      "Process check interval must be from {min}-{max} s.",
    "error.widthInvalid": "Width must be an integer from 640-10000.",
    "error.heightInvalid": "Height must be an integer from 480-10000.",
    "error.refreshRateInvalid":
      "Refresh rate must be an integer from 30-1000 Hz.",
    "message.presetApplied": "Applied {mode} for {monitorName}.",
    "display.applyFailed": "Could not apply mode {mode}. Windows code: {code}.",
    "display.emptyPowerShell": "PowerShell returned no output.",
    "display.listFailed": "Could not fetch the monitor list.",
    "display.missingMonitorId": "Missing monitor identifier.",
    "display.powerShellFailed": "PowerShell exited with code {code}.",
    "display.readCurrentFailed":
      "Could not read the current mode for monitor {deviceName}.",
    "display.testRejected":
      "Windows rejected the mode test for {mode}. Windows code: {code}.",
    "display.windowsOnly": "Resolution changes are only supported on Windows.",
  },
} as const;

export type TranslationKey = keyof (typeof TRANSLATIONS)[typeof DEFAULT_LOCALE];

type Replacements = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export function formatMode(
  width: number,
  height: number,
  refreshRate: number,
): string {
  return `${width}x${height} @ ${refreshRate} Hz`;
}

export function t(
  locale: Locale,
  key: TranslationKey,
  replacements: Replacements = {},
): string {
  const template =
    TRANSLATIONS[locale][key] ?? TRANSLATIONS[DEFAULT_LOCALE][key];

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const replacement = replacements[name];
    return replacement === undefined ? match : String(replacement);
  });
}
