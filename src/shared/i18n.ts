import TRANSLATIONS from "./translations.json";

export const LOCALES = ["pl", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pl";

export const THEME_MODES = ["auto", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "auto";

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
