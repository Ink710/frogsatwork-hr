import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { makeI18nServer } from "@hris/ui/i18n-server";
import { TIMEZONE_COOKIE, normalizeTimeZone } from "./timezone.js";
import { messagesFor } from "./messages/index.js";

// The locale mechanism lives in @hris/ui; this app supplies its own dictionary. Called once at
// module scope so the underlying cache() wrappers keep a stable identity (per-request dedupe).
export const { getLocale, getT } = makeI18nServer(messagesFor);

// Timezone stays HERE: it's specific to this app's wall-clock domain (shifts, punches, day
// boundaries), not shared suite infrastructure. The viewer's tz comes from the cookie the client
// sets. The try/catch lets this be called outside a request scope (tests) without throwing — it
// just falls back to DEFAULT_TIME_ZONE. See lib/timezone.js.
export const getTimeZone = cache(async () => {
  try {
    const store = await cookies();
    return normalizeTimeZone(store.get(TIMEZONE_COOKIE)?.value);
  } catch {
    return normalizeTimeZone(undefined);
  }
});
