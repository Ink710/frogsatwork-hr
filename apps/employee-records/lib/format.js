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
