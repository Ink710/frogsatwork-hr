// Small presentation helpers shared across the list and profile views.

// FULL_TIME -> "Full time", ON_LEAVE -> "On leave"
export function humanize(value) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// A Date (or null) -> "Apr 1, 2023" (or null so callers can show "Present").
export function formatDate(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

// A Date (or null) -> "Apr 1, 2023, 3:42 PM". Audit events need time-of-day; formatDate
// stays date-only for effective dates, which are calendar facts, not instants.
export function formatDateTime(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

// Sentinel the audit query substitutes for compensation values the viewer may not see.
// Lives here (not in queries.js) because the client-side AuditLogList must compare
// against it, and queries.js is server-only.
export const REDACTED = "[REDACTED]";

// A salary string/number + ISO currency -> "$112,000". Returns null for missing input
// so callers never accidentally render a blank/zero for guarded compensation.
export function formatMoney(amount, currency = "USD") {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}
