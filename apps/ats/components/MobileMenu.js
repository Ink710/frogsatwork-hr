"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

// Collapsible menu for small screens. AppHeader (a server component) computes the nav items,
// labels, and the sign-out server action and passes them in — this component only owns the
// open/closed UI state, so the header itself stays server-rendered.
export function MobileMenu({ navItems, prefsHref, prefsLabel, signOutLabel, logout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <>
          {/* Click-away layer: closes the menu when tapping anywhere else. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={prefsHref}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {prefsLabel}
            </Link>
            <form action={logout} className="border-t border-border">
              <button
                type="submit"
                className="w-full px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {signOutLabel}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
