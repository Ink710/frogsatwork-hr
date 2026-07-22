import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// Mock only the thin Next wrappers + getViewer; keep ALL real logic (withViewer, RLS, predicates,
// the Zod schema). Same approach as the employee-records action tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("../lib/i18n.js");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  const scope = await import("../../../packages/auth/src/scope");
  return {
    getViewer: vi.fn(), // set per test
    withViewer: rls.withViewer,
    isHrRole: roles.isHrRole,
    getSubtreeIds: scope.getSubtreeIds,
  };
});

import { getViewer, withViewer } from "@hris/auth";
import { submitTimeOff, approveTimeOff, denyTimeOff, cancelTimeOff } from "../app/time-off/actions.js";
import { getTimeOffOverview, getPendingLeave } from "../lib/queries.js";
import { runAccrualForOrg } from "../lib/accrual.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
};
const PRIYA_EMP = "40000000-0000-0000-0000-000000000005";
// Seeded requests (Diego): a PENDING PERSONAL 8h and an APPROVED VACATION 24h.
const REQ_PENDING = "req-diego-pending";
const REQ_APPROVED = "req-diego-approved";

// LeaveRequest / LeaveLedgerEntry are RLS-gated, so a bare `prisma` read (no session vars) sees
// NOTHING. Read back through an HR viewer (Ana sees all) to verify what an action actually wrote.
const asHr = (fn) => withViewer(V.ana, fn);

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.set(k, String(v));
  return fd;
}
// Actions throw a REDIRECT on success and return { error } on failure — normalize both.
async function run(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e.__redirect) return { redirect: e.message };
    throw e;
  }
}
const submit = (fields) => run(submitTimeOff(undefined, form(fields)));
const approve = (id, note) => run(approveTimeOff(id, undefined, form({ decisionNote: note })));
const deny = (id, note) => run(denyTimeOff(id, undefined, form({ decisionNote: note })));
const cancel = (id) => run(cancelTimeOff(id, undefined));

// Balance for (employee, type) = Σ signed ledger hours, read through HR (RLS-visible).
async function balance(employeeId, type) {
  const rows = await asHr((tx) => tx.leaveLedgerEntry.findMany({ where: { employeeId, type }, select: { hours: true } }));
  return rows.reduce((s, r) => s + Number(r.hours), 0);
}
const findReq = (id) => asHr((tx) => tx.leaveRequest.findUnique({ where: { id } }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("submitTimeOff", () => {
  it("lets an employee file for themselves → PENDING request + audit row", async () => {
    getViewer.mockResolvedValue(V.diego);
    const res = await submit({ type: "VACATION", startDate: "2026-09-01", endDate: "2026-09-03", hours: "24", reason: "Trip" });
    expect(res.redirect).toBe("REDIRECT:/time-off");

    const req = await asHr((tx) => tx.leaveRequest.findFirst({ where: { employeeId: V.diego.employeeId, reason: "Trip" } }));
    expect(req).toBeTruthy();
    expect(req.status).toBe("PENDING");
    expect(req.createdById).toBe(V.diego.userId);
    expect(Number(req.hours)).toBe(24);

    const audits = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: "TIME_OFF_REQUEST" } }));
    expect(audits).toBe(1);
  });

  it("blocks a non-HR employee from filing on behalf of someone else", async () => {
    getViewer.mockResolvedValue(V.diego);
    const res = await submit({ type: "VACATION", startDate: "2026-09-01", endDate: "2026-09-01", hours: "8", employeeId: PRIYA_EMP });
    expect(res.error).toMatch(/Only HR/i);
    const count = await asHr((tx) => tx.leaveRequest.count({ where: { employeeId: PRIYA_EMP } }));
    expect(count).toBe(0); // Priya had no seeded requests, and none was created for her
  });

  it("lets HR file on behalf of another employee", async () => {
    getViewer.mockResolvedValue(V.ana);
    const res = await submit({ type: "SICK", startDate: "2026-09-07", endDate: "2026-09-07", hours: "8", reason: "Filed by HR", employeeId: PRIYA_EMP });
    expect(res.redirect).toBe("REDIRECT:/time-off");
    const req = await asHr((tx) => tx.leaveRequest.findFirst({ where: { employeeId: PRIYA_EMP, type: "SICK" } }));
    expect(req).toBeTruthy();
    expect(req.createdById).toBe(V.ana.userId); // filed BY Ana, FOR Priya
  });

  it("rejects invalid input (end before start) without writing", async () => {
    getViewer.mockResolvedValue(V.diego);
    const res = await submit({ type: "VACATION", startDate: "2026-09-03", endDate: "2026-09-01", hours: "8" });
    expect(res.error).toMatch(/end date/i);
  });
});

describe("getTimeOffOverview", () => {
  it("scopes to the viewer and computes ledger balances + pending", async () => {
    getViewer.mockResolvedValue(V.diego);
    const overview = await getTimeOffOverview();
    expect(overview.subject.id).toBe(V.diego.employeeId);
    expect(overview.isSelf).toBe(true);

    const byType = Object.fromEntries(overview.balances.map((b) => [b.type, b]));
    // Seed: VACATION opening 80 − 24 used = 56; PERSONAL opening 16, one PENDING request of 8h.
    expect(byType.VACATION.available).toBe(56);
    expect(byType.VACATION.used).toBe(24);
    expect(byType.PERSONAL.pending).toBe(8);
    // Seed gives Diego two requests (one APPROVED, one PENDING).
    expect(overview.requests).toHaveLength(2);
  });
});

describe("approve / deny / cancel", () => {
  it("a manager approves a report's request → APPROVED + USAGE ledger + balance drop + audit", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const res = await approve(REQ_PENDING, "Have a good one");
    expect(res.redirect).toBe("REDIRECT:/approvals");

    const req = await findReq(REQ_PENDING);
    expect(req.status).toBe("APPROVED");
    expect(req.reviewedById).toBe(V.marcus.userId);
    expect(await balance(V.diego.employeeId, "PERSONAL")).toBe(8); // 16 − 8
    const usage = await asHr((tx) => tx.leaveLedgerEntry.findFirst({ where: { leaveRequestId: REQ_PENDING, source: "USAGE" } }));
    expect(Number(usage.hours)).toBe(-8);
    const audit = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: "TIME_OFF_APPROVE" } }));
    expect(audit).toBe(1);
  });

  it("an employee cannot approve — not even their own request", async () => {
    getViewer.mockResolvedValue(V.diego);
    const res = await approve(REQ_PENDING);
    expect(res.error).toBeTruthy();
    expect((await findReq(REQ_PENDING)).status).toBe("PENDING");
  });

  it("a manager cannot approve outside their subtree", async () => {
    // Bianca (HR_GENERALIST, reports to Ana) is NOT in Marcus's subtree.
    getViewer.mockResolvedValue(V.bianca);
    await submit({ type: "VACATION", startDate: "2026-09-01", endDate: "2026-09-01", hours: "8" });
    const biancaReq = await asHr((tx) => tx.leaveRequest.findFirst({ where: { employeeId: V.bianca.employeeId, status: "PENDING" } }));

    getViewer.mockResolvedValue(V.marcus);
    const res = await approve(biancaReq.id);
    expect(res.error).toBeTruthy(); // RLS hides it → "Request not found"
    expect((await findReq(biancaReq.id)).status).toBe("PENDING");
  });

  it("HR denies a request → DENIED, no ledger change, audited", async () => {
    const before = await asHr((tx) => tx.leaveLedgerEntry.count({ where: { employeeId: V.diego.employeeId } }));
    getViewer.mockResolvedValue(V.ana);
    const res = await deny(REQ_PENDING, "Coverage gap");
    expect(res.redirect).toBe("REDIRECT:/approvals");

    expect((await findReq(REQ_PENDING)).status).toBe("DENIED");
    const after = await asHr((tx) => tx.leaveLedgerEntry.count({ where: { employeeId: V.diego.employeeId } }));
    expect(after).toBe(before); // deny never touches the ledger
    const audit = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: "TIME_OFF_DENY" } }));
    expect(audit).toBe(1);
  });

  it("the subject cancels a pending request → CANCELLED, no ledger", async () => {
    const before = await asHr((tx) => tx.leaveLedgerEntry.count({ where: { employeeId: V.diego.employeeId } }));
    getViewer.mockResolvedValue(V.diego);
    const res = await cancel(REQ_PENDING);
    expect(res.redirect).toBe("REDIRECT:/time-off");
    expect((await findReq(REQ_PENDING)).status).toBe("CANCELLED");
    expect(await asHr((tx) => tx.leaveLedgerEntry.count({ where: { employeeId: V.diego.employeeId } }))).toBe(before);
  });

  it("cancelling an APPROVED request writes a REVERSAL and restores the balance", async () => {
    expect(await balance(V.diego.employeeId, "VACATION")).toBe(56); // 80 − 24 (seeded usage)
    getViewer.mockResolvedValue(V.diego);
    const res = await cancel(REQ_APPROVED);
    expect(res.redirect).toBe("REDIRECT:/time-off");
    expect((await findReq(REQ_APPROVED)).status).toBe("CANCELLED");
    const reversal = await asHr((tx) => tx.leaveLedgerEntry.findFirst({ where: { leaveRequestId: REQ_APPROVED, source: "REVERSAL" } }));
    expect(Number(reversal.hours)).toBe(24);
    expect(await balance(V.diego.employeeId, "VACATION")).toBe(80); // restored
  });
});

describe("getPendingLeave", () => {
  it("a manager sees their reports' pending requests", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const ids = (await getPendingLeave()).map((r) => r.id);
    expect(ids).toContain(REQ_PENDING); // Diego is Marcus's report
  });
  it("an employee gets an empty queue", async () => {
    getViewer.mockResolvedValue(V.diego);
    expect(await getPendingLeave()).toEqual([]);
  });
  it("HR sees pending requests across the org", async () => {
    getViewer.mockResolvedValue(V.ana);
    expect((await getPendingLeave()).map((r) => r.id)).toContain(REQ_PENDING);
  });
});

describe("runAccrualForOrg (accrual engine)", () => {
  it("posts monthly accrual, skips non-accruing types, and is idempotent", async () => {
    const period = "2026-07"; // every seeded employee was hired before this → full accrual
    expect(await balance(V.diego.employeeId, "VACATION")).toBe(56); // 80 − 24

    const r1 = await runAccrualForOrg(ORG, period);
    expect(r1.period).toBe(period);
    expect(r1.created).toBeGreaterThan(0);
    // VACATION accrues 13.34/mo → 56 + 13.34.
    expect(await balance(V.diego.employeeId, "VACATION")).toBeCloseTo(69.34, 2);
    // UNPAID policy has accrues=false → no entry.
    expect(await balance(V.diego.employeeId, "UNPAID")).toBe(0);

    // Re-running the same period is a no-op (unique accrualPeriod + createMany skipDuplicates).
    const r2 = await runAccrualForOrg(ORG, period);
    expect(r2.created).toBe(0);
    expect(await balance(V.diego.employeeId, "VACATION")).toBeCloseTo(69.34, 2);
  });
});
