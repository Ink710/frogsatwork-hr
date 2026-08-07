import en from "./en.js";
import es from "./es.js";
import { DEFAULT_LOCALE } from "@hris/ui";

const DICTS = { en, es };

export function messagesFor(locale) {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}
