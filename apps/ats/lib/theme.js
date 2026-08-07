// Theme preference helpers (client-side). Three states:
//   "system" (default) — follow the OS/browser prefers-color-scheme
//   "light" / "dark"    — an explicit override that beats the OS setting
// The choice lives in localStorage (per-browser). The actual work is toggling the `.dark` class
// on <html>, which drives both the CSS variables and Tailwind's `dark:` utilities.
export const THEME_KEY = "theme";
export const THEMES = ["system", "light", "dark"];

// Read the saved preference, defaulting to "system". Safe on the server (returns "system").
export function getStoredTheme() {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(THEME_KEY);
  return THEMES.includes(v) ? v : "system";
}

// Resolve a preference to the concrete "light" | "dark" actually shown right now.
export function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

// Apply a preference to the document: toggle `.dark` and set color-scheme (so native controls,
// scrollbars, and form widgets match). Does NOT persist — callers decide when to save.
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

// --- Subscription so components can read the preference via useSyncExternalStore ---
// (the React-recommended way to read external mutable state without a hydration mismatch).
const listeners = new Set();

// Subscribe to preference changes: same-tab writes (setTheme notifies) + other-tab writes
// (the storage event). Returns an unsubscribe fn.
export function subscribeTheme(callback) {
  const onStorage = (e) => {
    if (!e || e.key === THEME_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  listeners.add(callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(callback);
  };
}

// Persist + apply in one step (used by the toggle), then notify same-tab subscribers.
export function setTheme(theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode / storage disabled — still apply for this session.
  }
  applyTheme(theme);
  listeners.forEach((cb) => cb());
}
