import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, normalizeLocale, createTranslator } from "../i18n";

// Server-side i18n, as a FACTORY. The mechanism (read the locale cookie → build a translator) is
// identical in every app; only the DICTIONARY differs. So each app owns its own
// `lib/messages/{en,es}.js` and calls this once at module scope:
//
//   export const { getLocale, getT } = makeI18nServer(messagesFor);
//
// Calling it at module scope matters: `cache()` must wrap a stable function identity to dedupe
// within a request, which it does as long as the app calls this once per module (not per request).
export function makeI18nServer(messagesFor) {
  // Read the active locale from the cookie (Server Components / actions). Defaults to "en" when
  // unset or invalid. The try/catch lets callers use this outside a request scope (tests) without
  // throwing — cookies() is only available during a request.
  const getLocale = cache(async () => {
    try {
      const store = await cookies();
      return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
    } catch {
      return normalizeLocale(undefined);
    }
  });

  // Server-side translator: `const t = await getT();` then `t("nav.employees")`.
  const getT = cache(async () => {
    const locale = await getLocale();
    return createTranslator(messagesFor(locale));
  });

  return { getLocale, getT };
}
