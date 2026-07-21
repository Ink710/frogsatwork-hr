// Pure PTO business rules — no I/O, no framework. Unit-tested; safe to import from client or
// server. Balances are always derived from ledger rows (never a stored counter), so a balance is
// explainable by summing its entries.
import { LEAVE_TYPES } from "./leave";

// Hours in one standard workday. Used to turn a date range into a default request size.
// (Part-time schedules differ; that refinement is out of scope — 8h is the default unit.)
export const STANDARD_WORKDAY_HOURS = 8;

type DateInput = Date | string | number;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Whole business days (Mon–Fri) between two calendar dates, INCLUSIVE of both ends. Weekends are
// excluded; public holidays are NOT considered (out of scope — noted). Returns 0 if end precedes
// start. Computed in UTC to match how calendar dates are stored (UTC midnight).
export function businessDaysBetween(start: DateInput, end: DateInput): number {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  let count = 0;
  const cursor = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  while (cursor <= last) {
    const day = cursor.getUTCDay(); // 0 = Sun … 6 = Sat
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

// The default size of a request over a date range: business days × a standard workday.
export function defaultLeaveHours(start: DateInput, end: DateInput): number {
  return businessDaysBetween(start, end) * STANDARD_WORKDAY_HOURS;
}

export type LedgerRow = { type: string; hours: number | string };
export type BalanceLine = { balance: number; used: number; credited: number };

// Fold a set of ledger rows into per-type balances. balance = Σ hours; `used` = total deducted
// (USAGE rows are negative); `credited` = total granted (opening/accrual/adjustment/reversal).
// Every leave type is present in the result (0s) so the UI can render a full grid.
export function computeBalances(entries: LedgerRow[]): Record<string, BalanceLine> {
  const out: Record<string, BalanceLine> = {};
  for (const t of LEAVE_TYPES) out[t] = { balance: 0, used: 0, credited: 0 };
  for (const e of entries) {
    const h = Number(e.hours);
    if (!Number.isFinite(h)) continue;
    const line = out[e.type] ?? (out[e.type] = { balance: 0, used: 0, credited: 0 });
    line.balance += h;
    if (h < 0) line.used += -h;
    else line.credited += h;
  }
  for (const t of Object.keys(out)) {
    out[t] = { balance: round2(out[t].balance), used: round2(out[t].used), credited: round2(out[t].credited) };
  }
  return out;
}

export type RequestRow = { type: string; hours: number | string; status: string };

// Hours currently committed to PENDING requests, per type — what "available minus pending" needs.
export function pendingHours(requests: RequestRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of LEAVE_TYPES) out[t] = 0;
  for (const r of requests) {
    if (r.status !== "PENDING") continue;
    const h = Number(r.hours);
    if (Number.isFinite(h)) out[r.type] = round2((out[r.type] ?? 0) + h);
  }
  return out;
}

// Minimal viewer shape this rule needs (kept structural so this package doesn't depend on
// @hris/auth). Role strings mirror the Prisma `Role` enum values.
type ApprovalViewer = { employeeId: string | null; role: string };

// Whether `viewer` may approve/deny a request belonging to `subjectId`. The record-visibility half
// (can they even SEE it) is enforced separately by RLS; this is the app-layer ACTION gate — the same
// split as the compensation guard. Rules:
//   - No one approves their OWN request (separation of duties), whatever their role.
//   - HR (HR_ADMIN / HR_GENERALIST) may approve anyone in the org.
//   - A MANAGER may approve anyone in their reporting subtree (caller passes `subtreeIds`).
//   - EMPLOYEE / PAYROLL_ADMIN / SYSTEM: never.
export function canApproveTimeOff(
  viewer: ApprovalViewer,
  subjectId: string,
  ctx: { subtreeIds?: Set<string> } = {},
): boolean {
  if (!subjectId || subjectId === viewer.employeeId) return false; // never your own
  switch (viewer.role) {
    case "HR_ADMIN":
    case "HR_GENERALIST":
      return true;
    case "MANAGER":
      return ctx.subtreeIds?.has(subjectId) ?? false;
    default:
      return false;
  }
}

export type AccrualPolicy = {
  accrualHoursPerMonth: number;
  maxBalanceHours: number | null; // cap; null = uncapped
  accrues: boolean;
};

// Hours to accrue for one employee, one leave type, one month `period` ("YYYY-MM"). Pure so the
// engine's arithmetic is unit-tested in isolation. Rules:
//   - Non-accruing policy (e.g. UNPAID) → 0.
//   - Hired AFTER the period → 0 (not employed yet).
//   - Hired DURING the period → prorate by the fraction of calendar days worked that month.
//   - Otherwise → the full monthly rate.
//   - Capped: never accrue past maxBalanceHours (a monthly cap, computed against the balance at
//     run time — so a capped month is genuinely skipped, not deferred).
export function computeAccrual({
  policy,
  hireDate,
  period,
  currentBalance = 0,
}: {
  policy: AccrualPolicy;
  hireDate: Date | string | number;
  period: string;
  currentBalance?: number;
}): number {
  if (!policy?.accrues) return 0;
  const base = Number(policy.accrualHoursPerMonth) || 0;
  if (base <= 0) return 0;

  const [py, pm] = period.split("-").map(Number); // period year + month (1–12)
  const hire = new Date(hireDate);
  const hy = hire.getUTCFullYear();
  const hm = hire.getUTCMonth() + 1;

  // Hired after this period → not employed during it → nothing accrues.
  if (hy > py || (hy === py && hm > pm)) return 0;

  let amount = base;
  // Hired within this period → prorate by days worked. Date.UTC(py, pm, 0) is the last day of the
  // period month (day 0 of the following month), which gives the month's length.
  if (hy === py && hm === pm) {
    const daysInMonth = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const hireDay = hire.getUTCDate();
    amount = base * ((daysInMonth - hireDay + 1) / daysInMonth);
  }
  amount = Math.round(amount * 100) / 100;

  if (policy.maxBalanceHours != null) {
    const room = Math.max(0, Number(policy.maxBalanceHours) - Number(currentBalance));
    amount = Math.min(amount, room);
  }
  return Math.max(0, Math.round(amount * 100) / 100);
}
