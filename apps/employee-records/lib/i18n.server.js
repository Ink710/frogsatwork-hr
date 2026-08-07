import { makeI18nServer } from "@hris/ui/i18n-server";
import { messagesFor } from "./messages/index.js";

// The mechanism lives in @hris/ui; this app supplies its own dictionary. Called once at module
// scope so the underlying cache() wrappers keep a stable identity (per-request dedupe).
export const { getLocale, getT } = makeI18nServer(messagesFor);
