import { Manrope, Inter, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeWatcher, LocaleProvider } from "@hris/ui/client";
import { ThemeScript } from "@hris/ui/server";
import { getLocale } from "@/lib/i18n.server";
import { messagesFor } from "@/lib/messages/index.js";

// FAW HR type stack: Manrope titles, Inter body, IBM Plex Sans tables, JetBrains Mono for IDs.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata = {
  title: "Careers · FrogsAtWorkHR",
  description: "Open roles at FrogsAtWork — find a job and track your application.",
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
      {/* Unlike the ATS, whose root layout stays bare so its public careers pages render no internal
          chrome, this app's shell IS the public one — so the site header belongs here. The private
          /portal area (M4/M5) will add its own signed-in header in a nested layout. */}
      <body className="min-h-full flex flex-col">
        <ThemeWatcher />
        <LocaleProvider locale={locale} messages={messages}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
