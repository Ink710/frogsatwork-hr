"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE_COOKIE, detectBrowserTimeZone, setTimeZoneCookie } from "@/lib/timezone";

// Mounted once in the root layout. On load it detects the browser's IANA timezone and, if the cookie
// doesn't already match, stores it and refreshes so Server Components re-render times in the local
// zone. Renders nothing. Mirrors ThemeWatcher (a mount-only client sync component).
export function TimeZoneWatcher() {
  const router = useRouter();
  useEffect(() => {
    const tz = detectBrowserTimeZone();
    if (!tz) return;
    const current = document.cookie.match(new RegExp(`(?:^|; )${TIMEZONE_COOKIE}=([^;]+)`))?.[1];
    if (current !== tz) {
      setTimeZoneCookie(tz);
      router.refresh(); // re-fetch Server Components with the correct timezone cookie
    }
  }, [router]);

  return null;
}
