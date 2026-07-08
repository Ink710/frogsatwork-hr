"use client";

import { useEffect } from "react";
import { applyTheme, getStoredTheme } from "@/lib/theme";

// Mounted once in the root layout. Renders nothing; it just keeps the live theme in sync while
// the app is open: when the preference is "system", it re-applies on OS light/dark changes, and
// it mirrors a change made in another tab (storage event). The initial paint is already handled
// by the inline script in the layout <head>.
export function ThemeWatcher() {
  useEffect(() => {
    applyTheme(getStoredTheme());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    const onStorage = (e) => {
      if (e.key === "theme") applyTheme(getStoredTheme());
    };

    mq.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
