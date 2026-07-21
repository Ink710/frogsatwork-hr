import { describe, it, expect } from "vitest";
import {
  businessDaysBetween,
  defaultLeaveHours,
  computeBalances,
  pendingHours,
  canApproveTimeOff,
  computeAccrual,
  STANDARD_WORKDAY_HOURS,
} from "./index.ts";

describe("businessDaysBetween", () => {
  it("counts weekdays inclusive of both ends", () => {
    // Mon 2026-07-20 → Fri 2026-07-24 = 5 business days.
    expect(businessDaysBetween("2026-07-20", "2026-07-24")).toBe(5);
    // A single weekday = 1.
    expect(businessDaysBetween("2026-07-20", "2026-07-20")).toBe(1);
  });

  it("excludes weekends", () => {
    // Fri 2026-07-24 → Mon 2026-07-27 spans a weekend = Fri + Mon = 2.
    expect(businessDaysBetween("2026-07-24", "2026-07-27")).toBe(2);
    // Sat + Sun only = 0.
    expect(businessDaysBetween("2026-07-25", "2026-07-26")).toBe(0);
  });

  it("returns 0 when the range is reversed or invalid", () => {
    expect(businessDaysBetween("2026-07-24", "2026-07-20")).toBe(0);
    expect(businessDaysBetween("not-a-date", "2026-07-24")).toBe(0);
  });
});

describe("defaultLeaveHours", () => {
  it("is business days × a standard workday", () => {
    expect(defaultLeaveHours("2026-07-20", "2026-07-24")).toBe(5 * STANDARD_WORKDAY_HOURS);
  });
});

describe("computeBalances", () => {
  it("nets signed entries into balance, used, and credited per type", () => {
    const b = computeBalances([
      { type: "VACATION", hours: "80.00" }, // opening
      { type: "VACATION", hours: 13.34 }, // accrual
      { type: "VACATION", hours: -24 }, // usage
      { type: "SICK", hours: 40 },
    ]);
    expect(b.VACATION.balance).toBe(69.34);
    expect(b.VACATION.used).toBe(24);
    expect(b.VACATION.credited).toBe(93.34);
    expect(b.SICK.balance).toBe(40);
    // Every leave type is present, even with no entries.
    expect(b.PERSONAL).toEqual({ balance: 0, used: 0, credited: 0 });
    expect(b.UNPAID.balance).toBe(0);
  });

  it("ignores non-finite hours", () => {
    const b = computeBalances([{ type: "VACATION", hours: "oops" }, { type: "VACATION", hours: 8 }]);
    expect(b.VACATION.balance).toBe(8);
  });
});

describe("pendingHours", () => {
  it("sums only PENDING requests, per type", () => {
    const p = pendingHours([
      { type: "PERSONAL", hours: 8, status: "PENDING" },
      { type: "PERSONAL", hours: 4, status: "PENDING" },
      { type: "VACATION", hours: 24, status: "APPROVED" }, // not pending → excluded
      { type: "SICK", hours: 8, status: "DENIED" }, // excluded
    ]);
    expect(p.PERSONAL).toBe(12);
    expect(p.VACATION).toBe(0);
    expect(p.SICK).toBe(0);
  });
});

describe("canApproveTimeOff", () => {
  const manager = { employeeId: "mgr", role: "MANAGER" };
  const subtree = { subtreeIds: new Set(["mgr", "report-a", "report-b"]) };

  it("never lets anyone approve their own request", () => {
    expect(canApproveTimeOff(manager, "mgr", subtree)).toBe(false);
    expect(canApproveTimeOff({ employeeId: "hr", role: "HR_ADMIN" }, "hr")).toBe(false);
  });

  it("lets HR approve anyone else", () => {
    expect(canApproveTimeOff({ employeeId: "hr", role: "HR_ADMIN" }, "someone")).toBe(true);
    expect(canApproveTimeOff({ employeeId: "hr2", role: "HR_GENERALIST" }, "someone")).toBe(true);
  });

  it("lets a manager approve only their subtree", () => {
    expect(canApproveTimeOff(manager, "report-a", subtree)).toBe(true);
    expect(canApproveTimeOff(manager, "outsider", subtree)).toBe(false);
    expect(canApproveTimeOff(manager, "report-a", {})).toBe(false); // no subtree context → deny
  });

  it("denies employees, payroll, and system", () => {
    expect(canApproveTimeOff({ employeeId: "e", role: "EMPLOYEE" }, "other")).toBe(false);
    expect(canApproveTimeOff({ employeeId: "p", role: "PAYROLL_ADMIN" }, "other")).toBe(false);
    expect(canApproveTimeOff({ employeeId: null, role: "SYSTEM" }, "other")).toBe(false);
  });
});

describe("computeAccrual", () => {
  const vacation = { accrualHoursPerMonth: 13.34, maxBalanceHours: 240, accrues: true };

  it("grants the full monthly rate for someone hired before the period", () => {
    expect(computeAccrual({ policy: vacation, hireDate: "2020-01-01", period: "2026-07" })).toBe(13.34);
  });

  it("prorates the hire month by days worked", () => {
    // Hired Jul 15 of a 31-day month → (31 − 15 + 1)/31 = 17/31 of 13.34 ≈ 7.32.
    const a = computeAccrual({ policy: vacation, hireDate: "2026-07-15", period: "2026-07" });
    expect(a).toBeCloseTo((13.34 * 17) / 31, 2);
  });

  it("gives nothing before the hire month or for a non-accruing policy", () => {
    expect(computeAccrual({ policy: vacation, hireDate: "2026-09-01", period: "2026-07" })).toBe(0);
    const unpaid = { accrualHoursPerMonth: 0, maxBalanceHours: null, accrues: false };
    expect(computeAccrual({ policy: unpaid, hireDate: "2020-01-01", period: "2026-07" })).toBe(0);
  });

  it("respects the balance cap", () => {
    // 5h of room left → accrual clipped to 5.
    expect(computeAccrual({ policy: vacation, hireDate: "2020-01-01", period: "2026-07", currentBalance: 235 })).toBe(5);
    // Already at the cap → 0.
    expect(computeAccrual({ policy: vacation, hireDate: "2020-01-01", period: "2026-07", currentBalance: 240 })).toBe(0);
  });
});
