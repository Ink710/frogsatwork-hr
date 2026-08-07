"use client";

import { createContext, useContext, useMemo } from "react";
import { createTranslator, DEFAULT_LOCALE } from "@/lib/i18n";

// Bridges the server-read locale to Client Components. The root layout reads the cookie and
// passes { locale, messages }; here we build the translator once and expose it via context.
const LocaleContext = createContext({ locale: DEFAULT_LOCALE, t: (k) => k });

export function LocaleProvider({ locale, messages, children }) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(messages) }),
    [locale, messages],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// Client-component translator: `const t = useT();` then `t("nav.employees")`.
export function useT() {
  return useContext(LocaleContext).t;
}

export function useLocale() {
  return useContext(LocaleContext).locale;
}
