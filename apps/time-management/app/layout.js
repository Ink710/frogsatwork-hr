import { Manrope, Inter, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { ThemeWatcher, LocaleProvider } from "@hris/ui/client";
import { ThemeScript } from "@hris/ui/server";
import { TimeZoneWatcher } from "@/components/TimeZoneWatcher";
import { getLocale } from "@/lib/i18n.server";
import { messagesFor } from "@/lib/messages/index.js";

// FAW HR type stack: Manrope titles, Inter body, IBM Plex Sans tables, JetBrains Mono for IDs/hours.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata = {
  title: "Time & Attendance · FrogsAtWorkHR",
  description: "FAW HR — time off, timesheets, attendance & scheduling. Let’s jump into it.",
};

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const messages = messagesFor(locale);

  return (
    // suppressHydrationWarning: <ThemeScript> sets the `dark` class before React hydrates, which
    // would otherwise be flagged as a server/client attribute mismatch on <html>.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${manrope.variable} ${inter.variable} ${plexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeWatcher />
        <TimeZoneWatcher />
        <LocaleProvider locale={locale} messages={messages}>
          <AppHeader />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
