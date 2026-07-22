import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  const scope = await import("../../../packages/auth/src/scope");
  return {
    getViewer: vi.fn(),
    withViewer: rls.withViewer,
    isHrRole: roles.isHrRole,
    getSubtreeIds: scope.getSubtreeIds,
  };
});

import { getViewer } from "@hris/auth";
import { getMyTimeSnapshot, getTeamTimeSnapshot, getWhosOffToday } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
};

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("getMyTimeSnapshot (personal, every role)", () => {
  it("returns the self tiles for an employee (pending count from their own requests)", async () => {
    getViewer.mockResolvedValue(V.diego);
    const s = await getMyTimeSnapshot();
    expect(s).not.toBeNull();
    expect(s.clock).not.toBeNull(); // clock status resolved
    expect(s.timesheet).not.toBeNull(); // this week's sheet (DRAFT default)
    expect(typeof s.ptoAvailable).toBe("number");
    expect(s.pendingRequests).toBe(1); // Diego's seeded PENDING request (2026-08-10)
    expect(s).toHaveProperty("nextShift"); // null or a shift — presence, not value (clock-dependent)
  });
});

describe("getTeamTimeSnapshot (oversight, approvers only)", () => {
  it("is null for an employee", async () => {
    getViewer.mockResolvedValue(V.diego);
    expect(await getTeamTimeSnapshot()).toBeNull();
  });

  it("rolls up a manager's pending approvals + OT flags from seeded data", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const s = await getTeamTimeSnapshot();
    // Seed: Diego 1 PENDING leave, Tom 1 SUBMITTED timesheet (with OT), no swaps.
    expect(s.pendingApprovals).toEqual({ leave: 1, timesheets: 1, swaps: 0, total: 2 });
    expect(s.otFlags).toBe(1); // Tom's timesheet carries overtime
    // todayExceptions is a 4-key numeric object (counts are real-clock-dependent → shape only).
    expect(Object.keys(s.todayExceptions).sort()).toEqual(["absent", "late", "open", "short"]);
    for (const v of Object.values(s.todayExceptions)) expect(typeof v).toBe("number");
    expect(Array.isArray(s.whosOffToday)).toBe(true);
  });

  it("gives HR an org-wide roll-up (sees at least the same pending items)", async () => {
    getViewer.mockResolvedValue(V.ana);
    const s = await getTeamTimeSnapshot();
    expect(s.pendingApprovals.total).toBeGreaterThanOrEqual(2);
  });
});

describe("getWhosOffToday (RLS-scoped approved leave)", () => {
  it("a manager sees a report on approved leave; a peer employee sees no one", async () => {
    // Diego's seeded APPROVED vacation is 2026-03-16..18.
    getViewer.mockResolvedValue(V.marcus);
    const off = await getWhosOffToday("2026-03-17");
    expect(off.map((o) => o.employeeId)).toContain(V.diego.employeeId);
    expect(off.find((o) => o.employeeId === V.diego.employeeId).type).toBe("VACATION");

    getViewer.mockResolvedValue(V.priya); // peer, not a manager → RLS shows only her own (none)
    expect(await getWhosOffToday("2026-03-17")).toEqual([]);
  });
});
