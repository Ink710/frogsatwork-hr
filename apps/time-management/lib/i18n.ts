// Shared i18n core — safe in both Server and Client Components (no next/headers here).
// Locale lives in a cookie so Server Components can read it and render translated text with no
// flash and no URL prefix. Custom dictionaries (no dependency): a flat key → string map per
// locale, with simple {var} interpolation.

export const LOCALES = ["en", "es"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

// The set of supported locales, derived from LOCALES so it can never drift from the runtime list.
export type Locale = (typeof LOCALES)[number];

// BCP-47 tags for Intl (dates/numbers). Typed as a full Record<Locale, string> so indexing by
// any Locale is known-safe and a new locale would force an entry here.
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-ES" };
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", es: "Español" };

export function normalizeLocale(value: unknown): Locale {
  // `.includes` is invariant on the array's element type, so it won't take an arbitrary
  // `unknown`/`string`. We assert `value as Locale` purely to satisfy the check; if it isn't
  // actually one of the literals, `.includes` returns false and we fall back to DEFAULT_LOCALE.
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}

// A flat dictionary (key → template string) for one locale.
export type Messages = Record<string, string>;
// A bound translator: look up a key, interpolate {var} placeholders.
export type Translator = (key: string, vars?: Record<string, string | number>) => string;

// Persist the locale in a cookie (client-side). Lives here, outside any component, so writing
// document.cookie isn't flagged as mutating external state inside a component/hook.
export function setLocaleCookie(locale: string) {
  if (typeof document !== "undefined") {
    document.cookie = `${LOCALE_COOKIE}=${normalizeLocale(locale)}; path=/; max-age=31536000; samesite=lax`;
  }
}

// Build a translator bound to one locale's messages. `t(key, vars?)` looks the key up and
// interpolates {var} placeholders; unknown keys fall back to the key itself (so a missing
// translation is visible in dev rather than rendering blank).
export function createTranslator(messages: Messages): Translator {
  return function t(key, vars) {
    let s = messages[key];
    if (s == null) s = key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.replaceAll(`{${k}}`, String(vars[k]));
      }
    }
    return s;
  };
}
