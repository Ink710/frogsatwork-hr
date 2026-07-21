// Shared, server-safe presentational primitives for the tabbed employee profile.
// No "use client" — these are pure markup, reused by the Overview cards, the sidebar, and
// the other tab pages so the whole profile shares one visual language. All colors are semantic
// design tokens (bg-card, border-border, text-muted-foreground…), so they theme automatically.
import { humanize } from "@/lib/format";

// Status colors mapped to the semantic token palette.
const STATUS_STYLES = {
  ACTIVE: "text-success",
  ON_LEAVE: "text-warning",
  SUSPENDED: "text-destructive",
  TERMINATED: "text-muted-foreground",
};
const STATUS_DOT = {
  ACTIVE: "bg-success",
  ON_LEAVE: "bg-warning",
  SUSPENDED: "bg-destructive",
  TERMINATED: "bg-muted-foreground",
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

// Circular initials avatar, tinted with the brand primary.
export function Avatar({ initials, className = "h-20 w-20 text-2xl" }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// A titled content card. `action` renders top-right (e.g. the "HR Admin only" badge).
export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-6 ${className}`}>
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

// A muted label above a bold value.
export function Field({ label, children }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children ?? "—"}</dd>
    </div>
  );
}

// Two-column responsive grid for Field rows inside a Card.
export function FieldGrid({ children }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">{children}</dl>;
}

// Content-area loading skeleton shaped like a Card.
export function CardSkeleton({ rows = 4 }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6" aria-busy="true">
      <div className="mb-5 h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Small pill used for the "HR Admin only" comp-card marker and similar hints.
export function Pill({ children, tone = "muted" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    highlight: "bg-highlight/20 text-foreground",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tones[tone] ?? tones.muted}`}>{children}</span>;
}
