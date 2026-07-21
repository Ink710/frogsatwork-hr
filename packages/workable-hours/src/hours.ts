// Pure hour math shared by every time-management domain (timesheets, attendance, leave).
// No I/O, no framework — trivially unit-testable, and safe to import from client or server.

type TimeInput = Date | string | number;

// Decimal hours between two instants, rounded to 2 decimals and never negative.
// e.g. 9:00 → 17:30 == 8.5. A clock-out that precedes the clock-in yields 0 (defensive; callers
// should already guarantee ordering).
export function hoursBetween(start: TimeInput, end: TimeInput): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

// Human-friendly duration: decimal hours → "8h" / "7h 30m" / "45m". Returns "—" for
// null/undefined/NaN so a missing value never renders blank. Minutes are rounded to whole.
export function formatHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
