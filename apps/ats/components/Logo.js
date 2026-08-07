"use client";

// Plain <img> (not next/image) on purpose: theme-swapped, tiny, and needs an onError fallback to
// the glyph when the brand files aren't present yet.
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";

// Minimal frog glyph — the fallback until the real artwork lands in /public/brand/. Stroke is
// currentColor, and we set it to primary (forest green) in light and foreground (off-white) in
// dark, mirroring the two supplied colorways.
function FrogGlyph({ size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary dark:text-foreground"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="3.4" />
      <circle cx="21" cy="11" r="3.4" />
      <circle cx="11" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="21" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <path d="M5.5 13c0 8.5 4.7 13 10.5 13s10.5-4.5 10.5-13" />
      <path d="M11.5 19c1.6 1.4 7.4 1.4 9 0" />
    </svg>
  );
}

// The FrogsAtWorkHR mark. Uses the theme-swapped frog images when they exist (drop them in
// public/brand/frog-light.png + frog-dark.png); otherwise it renders the glyph fallback so the
// brand is never a broken image. `wordmark` shows the full name (FAW HR on small screens).
export function Logo({ href = "/", size = 28, wordmark = true, className = "" }) {
  const [failed, setFailed] = useState(false);

  return (
    <Link href={href} className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        {failed ? (
          <FrogGlyph size={size} />
        ) : (
          <>
            {/* Blend modes drop the solid image backgrounds so the frog sits on the app surface:
                multiply erases the white behind the light logo, screen erases the black behind
                the dark one. (Transparent PNG/SVG exports would make this unnecessary.) */}
            <img
              src="/brand/frog-light.png"
              alt=""
              onError={() => setFailed(true)}
              className="h-full w-full object-contain mix-blend-multiply dark:hidden"
            />
            <img
              src="/brand/frog-dark.png"
              alt=""
              onError={() => setFailed(true)}
              className="hidden h-full w-full object-contain mix-blend-screen dark:block"
            />
          </>
        )}
      </span>
      {wordmark && (
        <span className="font-display text-base font-bold tracking-tight text-foreground">
          <span className="hidden sm:inline">
            Frogs<span className="text-primary">AtWork</span>HR
          </span>
          <span className="sm:hidden">FAW&nbsp;HR</span>
        </span>
      )}
    </Link>
  );
}
