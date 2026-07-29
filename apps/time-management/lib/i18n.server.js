import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, normalizeLocale, createTranslator } from "./i18n";
import { TIMEZONE_COOKIE, normalizeTimeZone } from "./timezone.js";
import { messagesFor } from "./messages/index.js";

// Read the active locale from the cookie (Server Components / actions). cache() dedupes the
// cookie read within a request. Defaults to "en" when unset or invalid.
export const getLocale = cache(async () => {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
});

// Server-side translator: `const t = await getT();` then `t("nav.employees")`.
export const getT = cache(async () => {
  const locale = await getLocale();
  return createTranslator(messagesFor(locale));
});

// The viewer's timezone (Server Components / actions), from the cookie the client sets. cache()
// dedupes per request. The try/catch lets this be called outside a request scope (tests) without
// throwing — it just falls back to DEFAULT_TIME_ZONE. See lib/timezone.js.
export const getTimeZone = cache(async () => {
  try {
    const store = await cookies();
    return normalizeTimeZone(store.get(TIMEZONE_COOKIE)?.value);
  } catch {
    return normalizeTimeZone(undefined);
  }
});
