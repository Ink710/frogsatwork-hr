import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { ThemeWatcher } from "@/components/ThemeWatcher";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getLocale } from "@/lib/i18n.server";
import { messagesFor } from "@/lib/messages/index.js";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "PeopleBase",
  description: "Lightweight HRIS — employee records module",
};

// Runs synchronously in <head> BEFORE first paint, so the correct theme is applied with no
// flash of the wrong colors. Self-contained (can't import modules this early). Mirrors
// lib/theme.js: read the saved preference, fall back to "system" → the OS setting.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark')t='system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const messages = messagesFor(locale);

  return (
    // suppressHydrationWarning: the script above sets the `dark` class before React hydrates,
    // which would otherwise be flagged as a server/client attribute mismatch on <html>.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeWatcher />
        <LocaleProvider locale={locale} messages={messages}>
          <AppHeader />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
