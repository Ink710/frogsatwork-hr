// The viewer's timezone lives in a cookie so Server Components can format times in the local zone
// (mirrors the locale cookie in i18n.ts). Model A: every instant is stored true-UTC; this cookie only
// decides how times are DISPLAYED and how new shift/correction wall-clocks are interpreted. Safe in
// both Server and Client Components (no next/headers here).

export const TIMEZONE_COOKIE = "tz";

// Fallback when the cookie isn't set yet (first paint before the watcher runs, SSR, tests). A single
// constant — set it to your demo's region. DST-free UTC−6, matching the reported "8 PM" symptom.
export const DEFAULT_TIME_ZONE = "America/Mexico_City";

// True if `value` is an IANA timezone this runtime's Intl accepts (an invalid one throws RangeError).
export function isValidTimeZone(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Coerce a cookie value to a usable timezone, falling back to the default when unset/invalid.
export function normalizeTimeZone(value) {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

// The browser's current IANA timezone (client only), e.g. "America/Chicago". null when unavailable.
export function detectBrowserTimeZone() {
  if (typeof Intl === "undefined") return null;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

// Persist the timezone in a cookie (client-side), mirroring setLocaleCookie.
export function setTimeZoneCookie(tz) {
  if (typeof document !== "undefined" && isValidTimeZone(tz)) {
    document.cookie = `${TIMEZONE_COOKIE}=${tz}; path=/; max-age=31536000; samesite=lax`;
  }
}
