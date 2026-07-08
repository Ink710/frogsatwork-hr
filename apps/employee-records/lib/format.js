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
// These are CALENDAR dates — hire/effective/review dates stored as UTC midnight. We format in
// UTC so a negative-offset server timezone can't shift "2023-04-01" back to "Mar 31". (Contrast
// formatDateTime below, which is for real instants and stays in local time.)
export function formatDate(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
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

// PayBasis enum -> a short pay-period suffix, e.g. "$112,000 / yr". "" for missing so it
// composes cleanly with formatMoney (`${money}${formatPayBasis(basis)}`).
const PAY_BASIS_SUFFIX = { PER_HOUR: " / hr", PER_MONTH: " / mo", PER_YEAR: " / yr" };
export function formatPayBasis(payBasis) {
  return PAY_BASIS_SUFFIX[payBasis] ?? "";
}

// Uppercase two-letter avatar initials from a name, e.g. ("Ana","Castellanos") -> "AC".
export function initials(firstName = "", lastName = "") {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "—";
}

// Tenure between a hire date and now (or a termination date) -> "4 yrs 3 mos". Uses whole
// calendar months (not day-precise) — HR tenure is conventionally counted in months. Returns
// null for missing input; "< 1 mo" for brand-new hires so we never render an empty string.
export function formatTenure(hireDate, endDate = null) {
  if (!hireDate) return null;
  const start = new Date(hireDate);
  const end = endDate ? new Date(endDate) : new Date();
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1; // the current month isn't complete yet
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts = [];
  if (years) parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  if (rem) parts.push(`${rem} mo${rem === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" ") : "< 1 mo";
}
