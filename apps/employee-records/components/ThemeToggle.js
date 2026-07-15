"use client";

import { useSyncExternalStore } from "react";
import { THEMES, getStoredTheme, setTheme, subscribeTheme } from "@/lib/theme";
import { useT } from "./LocaleProvider";

// A three-way segmented control. useSyncExternalStore reads the saved preference from localStorage
// (an external store): the server snapshot is "system", so the first client paint matches and
// there's no hydration mismatch; after mount it reflects the real value and re-renders on change.
export function ThemeToggle() {
  const t = useT();
  const META = {
    system: { label: t("prefs.theme.system"), hint: t("prefs.theme.systemHint") },
    light: { label: t("prefs.theme.light"), hint: t("prefs.theme.lightHint") },
    dark: { label: t("prefs.theme.dark"), hint: t("prefs.theme.darkHint") },
  };
  const theme = useSyncExternalStore(subscribeTheme, getStoredTheme, () => "system");

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-lg border border-border p-1 ">
      {THEMES.map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            title={META[t].hint}
            onClick={() => setTheme(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted dark:text-muted-foreground/50 "
            }`}
          >
            {META[t].label}
          </button>
        );
      })}
    </div>
  );
}
