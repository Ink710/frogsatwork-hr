import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, normalizeLocale, createTranslator } from "./i18n.js";
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
