import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@hris/database";
import { resetDb } from "../../../test/resetDb.js";

// Same pattern as actions.itest.js: mock only getViewer (set per test); everything else —
// withViewer, RLS session vars, comp predicates — is the real thing against the test DB.
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls.js");
  const roles = await import("../../../packages/auth/src/roles.js");
  const scope = await import("../../../packages/auth/src/scope.js");
  return {
    getViewer: vi.fn(), // set per test
    withViewer: rls.withViewer,
    resolveCompAccess: scope.resolveCompAccess,
    getSubtreeIds: scope.getSubtreeIds,
    isPayroll: roles.isPayroll,
    canEditEmployee: roles.canEditEmployee,
    canEditCompensation: roles.canEditCompensation,
    canTerminate: roles.canTerminate,
    canViewBudget: roles.canViewBudget,
  };
});

import { getViewer, withViewer } from "@hris/auth";
import { getEmployeeAuditLog } from "../lib/queries.js";
import { REDACTED } from "../lib/format.js";

// Seeded ids (see packages/database/src/seed.js).
const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};

beforeEach(async () => {
  await resetDb();
  vi.mocked(getViewer).mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Insert audit rows as ana (HR sees everyone, so RLS WITH CHECK passes).
const insertViews = (employeeId, n) =>
  withViewer(V.ana, (tx) =>
    tx.employeeAuditLog.createMany({
      data: Array.from({ length: n }, () => ({
        employeeId,
        eventType: "VIEW",
        actorType: "USER",
        actorId: V.ana.userId,
      })),
    }),
  );

const insertSalaryUpdate = (employeeId, from, to) =>
  withViewer(V.ana, (tx) =>
    tx.employeeAuditLog.createMany({
      data: [
        {
          employeeId,
          eventType: "UPDATE",
          actorType: "USER",
          actorId: V.ana.userId,
          beforeState: { jobTitle: "Before Title", salary: from },
          afterState: { jobTitle: "After Title", salary: to },
        },
      ],
    }),
  );

describe("audit log read is RLS-scoped", () => {
  it("an EMPLOYEE can read their own trail but not a colleague's", async () => {
    await insertViews(V.diego.employeeId, 2);
    await insertViews(V.marcus.employeeId, 2);

    getViewer.mockResolvedValue(V.diego);
    const own = await getEmployeeAuditLog(V.diego.employeeId);
    expect(own.events).toHaveLength(2);
    expect(own.events.every((e) => e.eventType === "VIEW")).toBe(true);

    // Marcus is invisible to Diego under RLS → same null the profile 404s on.
    expect(await getEmployeeAuditLog(V.marcus.employeeId)).toBeNull();
  });

  it("a MANAGER can read a report's trail but not someone outside their subtree", async () => {
    await insertViews(V.diego.employeeId, 1);
    await insertViews(V.bianca.employeeId, 1);

    getViewer.mockResolvedValue(V.marcus);
    const report = await getEmployeeAuditLog(V.diego.employeeId);
    expect(report.events).toHaveLength(1);

    expect(await getEmployeeAuditLog(V.bianca.employeeId)).toBeNull();
  });

  it("no session → null", async () => {
    getViewer.mockResolvedValue(null);
    expect(await getEmployeeAuditLog(V.diego.employeeId)).toBeNull();
  });
});

describe("compensation redaction in diffs", () => {
  it("HR_GENERALIST sees a superior's rows but salary is redacted", async () => {
    await insertSalaryUpdate(V.ana.employeeId, "250000", "275000");

    getViewer.mockResolvedValue(V.bianca);
    const result = await getEmployeeAuditLog(V.ana.employeeId);
    expect(result.canViewComp).toBe(false);

    const [event] = result.events;
    expect(event.beforeState.salary).toBe(REDACTED);
    expect(event.afterState.salary).toBe(REDACTED);
    // Non-comp fields in the same diff are untouched.
    expect(event.beforeState.jobTitle).toBe("Before Title");
    expect(event.afterState.jobTitle).toBe("After Title");
    // The raw numbers are gone from the payload entirely.
    expect(JSON.stringify(result)).not.toContain("250000");
    expect(JSON.stringify(result)).not.toContain("275000");
  });

  it("an authorized viewer sees the real salary values", async () => {
    await insertSalaryUpdate(V.diego.employeeId, "85000", "92000");

    getViewer.mockResolvedValue(V.ana); // HR_ADMIN, diego is a subordinate
    const result = await getEmployeeAuditLog(V.diego.employeeId);
    expect(result.canViewComp).toBe(true);
    expect(result.events[0].beforeState.salary).toBe("85000");
    expect(result.events[0].afterState.salary).toBe("92000");
  });
});

describe("cursor pagination", () => {
  it("pages by 25 with no overlap and no gap", async () => {
    await insertViews(V.diego.employeeId, 30);

    getViewer.mockResolvedValue(V.ana);
    const page1 = await getEmployeeAuditLog(V.diego.employeeId);
    expect(page1.events).toHaveLength(25);
    expect(page1.nextCursor).toBe(page1.events.at(-1).id);

    const page2 = await getEmployeeAuditLog(V.diego.employeeId, page1.nextCursor);
    expect(page2.events).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();

    const ids = [...page1.events, ...page2.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(30); // every row exactly once
  });

  it("an exact multiple of the page size ends cleanly", async () => {
    await insertViews(V.diego.employeeId, 25);

    getViewer.mockResolvedValue(V.ana);
    const page1 = await getEmployeeAuditLog(V.diego.employeeId);
    expect(page1.events).toHaveLength(25);
    expect(page1.nextCursor).toBeNull(); // the +1 probe found nothing
  });
});
