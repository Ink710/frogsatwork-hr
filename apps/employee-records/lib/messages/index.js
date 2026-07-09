import en from "./en.js";
import es from "./es.js";
import { DEFAULT_LOCALE } from "../i18n.js";

const DICTS = { en, es };

export function messagesFor(locale) {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}
