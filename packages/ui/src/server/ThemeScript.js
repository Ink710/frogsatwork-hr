// The no-flash theme bootstrap, shared by all three apps.
//
// Runs SYNCHRONOUSLY in <head> before first paint, so the saved theme is applied before the browser
// paints anything and there is no flash of the wrong colours. That timing is the whole point, and it
// dictates every constraint here:
//
//   • It cannot import anything. Modules load too late, so the logic is duplicated from lib/theme.js
//     as a self-contained string — the one piece of duplication in this file that is load-bearing.
//   • It cannot be a client component or a useEffect. Both run after hydration, which is after paint.
//   • It must stay an inline <script>, not `next/script`. Anything deferred defeats it.
//
// Callers must also put `suppressHydrationWarning` on <html>, because this script sets the `dark`
// class before React hydrates and React would otherwise flag the mismatch.
//
// (Extracted in Polish A. It had been pasted verbatim into all three root layouts — the kind of
// duplication that silently drifts the first time someone fixes a bug in one copy.)
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark')t='system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
