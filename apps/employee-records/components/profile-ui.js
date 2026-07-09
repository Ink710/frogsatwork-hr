// Shared, server-safe presentational primitives for the tabbed employee profile.
// No "use client" — these are pure markup, reused by the Overview cards, the sidebar, and
// the other tab pages so the whole profile shares one visual language.
import { humanize } from "@/lib/format";

// Status pill colors — a single source of truth used by both the sidebar and any inline badge.
const STATUS_STYLES = {
  ACTIVE: "text-green-700 dark:text-green-400",
  ON_LEAVE: "text-amber-700 dark:text-amber-400",
  SUSPENDED: "text-red-700 dark:text-red-400",
  TERMINATED: "text-zinc-500 dark:text-zinc-400",
};
const STATUS_DOT = {
  ACTIVE: "bg-green-500",
  ON_LEAVE: "bg-amber-500",
  SUSPENDED: "bg-red-500",
  TERMINATED: "bg-zinc-400",
};

// A colored dot + status label (e.g. "● Active"). `label` is the translated text; falls back to
// humanize(status) when not provided.
export function StatusBadge({ status, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.TERMINATED}`}>
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.TERMINATED}`} />
      {label ?? humanize(status)}
    </span>
  );
}

// Circular initials avatar. `size` is a Tailwind size class pair.
export function Avatar({ initials, className = "h-20 w-20 text-2xl" }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300 ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// A titled content card. `action` renders top-right (e.g. the "HR Admin only" badge).
export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/40 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between gap-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// A grey label above/beside a value — the mockup's field style (grey label, bold value).
export function Field({ label, children }) {
  return (
    <div>
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children ?? "—"}</dd>
    </div>
  );
}

// Two-column responsive grid for Field rows inside a Card.
export function FieldGrid({ children }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">{children}</dl>;
}

// Content-area loading skeleton shaped like a Card. Used by the tab loading.js fallbacks,
// which render INSIDE the profile layout's content slot (so no full-page <main> wrapper).
export function CardSkeleton({ rows = 4 }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/40" aria-busy="true">
      <div className="mb-5 h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Small pill used for the "HR Admin only" comp-card marker and similar hints.
export function Pill({ children, tone = "zinc" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tones[tone] ?? tones.zinc}`}>{children}</span>;
}
