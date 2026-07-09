// Shared i18n core — safe in both Server and Client Components (no next/headers here).
// Locale lives in a cookie so Server Components can read it and render translated text with no
// flash and no URL prefix. Custom dictionaries (no dependency): a flat key → string map per
// locale, with simple {var} interpolation.

export const LOCALES = ["en", "es"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
// BCP-47 tags for Intl (dates/numbers).
export const INTL_LOCALE = { en: "en-US", es: "es-ES" };
export const LOCALE_LABELS = { en: "English", es: "Español" };

export function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

// Persist the locale in a cookie (client-side). Lives here, outside any component, so writing
// document.cookie isn't flagged as mutating external state inside a component/hook.
export function setLocaleCookie(locale) {
  if (typeof document !== "undefined") {
    document.cookie = `${LOCALE_COOKIE}=${normalizeLocale(locale)}; path=/; max-age=31536000; samesite=lax`;
  }
}

// Build a translator bound to one locale's messages. `t(key, vars?)` looks the key up and
// interpolates {var} placeholders; unknown keys fall back to the key itself (so a missing
// translation is visible in dev rather than rendering blank).
export function createTranslator(messages) {
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
