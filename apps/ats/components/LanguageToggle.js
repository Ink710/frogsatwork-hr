"use client";

import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS, setLocaleCookie } from "@/lib/i18n";
import { useLocale, useT } from "./LocaleProvider";

// Sets the locale cookie and refreshes, so Server Components re-render in the new language.
// A cookie (not localStorage) because the server reads it at render time — see lib/i18n.js.
export function LanguageToggle() {
  const router = useRouter();
  const active = useLocale();
  const t = useT();

  function choose(locale) {
    if (locale === active) return;
    setLocaleCookie(locale);
    router.refresh(); // re-fetch server components with the new cookie
  }

  return (
    <div role="radiogroup" aria-label={t("prefs.language")} className="inline-flex gap-1 rounded-lg border border-border p-1 ">
      {LOCALES.map((locale) => {
        const on = locale === active;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(locale)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted dark:text-muted-foreground/50 "
            }`}
          >
            {LOCALE_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
