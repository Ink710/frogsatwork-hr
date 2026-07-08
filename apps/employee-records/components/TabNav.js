"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The profile tab bar. Client-only so it can read the current path and underline the active
// tab. `tabs` = [{ href, label }] is built on the server (which decides which tabs the viewer
// may see — e.g. Access & RBAC is HR/self only), so this component stays purely presentational.
export function TabNav({ tabs }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              active
                ? "border-blue-600 text-zinc-900 dark:border-blue-400 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
