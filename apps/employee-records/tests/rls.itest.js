import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@hris/database";
import { withViewer } from "../../../packages/auth/src/rls.js";
import { resolveCompAccess } from "../../../packages/auth/src/scope.js";

// Seeded ids (see packages/database/src/seed.js).
const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};
const DEPT = { eng: "20000000-0000-0000-0000-000000000002", exec: "20000000-0000-0000-0000-000000000001" };

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RLS row scoping (naked findMany, no where clause)", () => {
  it("no session → sees nothing", async () => {
    expect(await prisma.employee.findMany()).toHaveLength(0);
  });

  it.each([
    ["ana", 7],
    ["marcus", 4],
    ["bianca", 7],
    ["diego", 1],
  ])("withViewer(%s) sees %i employees", async (who, expected) => {
    const rows = await withViewer(V[who], (tx) => tx.employee.findMany());
    expect(rows).toHaveLength(expected);
  });

  it("child tables scope too (history)", async () => {
    const diego = await withViewer(V.diego, (tx) => tx.employeeHistory.findMany());
    expect(diego).toHaveLength(2); // his own versions only
    const marcus = await withViewer(V.marcus, (tx) => tx.employeeHistory.findMany());
    expect(marcus).toHaveLength(5); // his subtree's versions (marcus1 + diego2 + priya1 + tom1)
  });
});

describe("compensation resolution under RLS", () => {
  it("HR_ADMIN can see a subordinate's comp", async () => {
    const ok = await withViewer(V.ana, (tx) =>
      resolveCompAccess(V.ana, { id: V.diego.employeeId, departmentId: DEPT.eng }, tx),
    );
    expect(ok).toBe(true);
  });
  it("HR_GENERALIST is blocked from a superior's comp", async () => {
    const ok = await withViewer(V.bianca, (tx) =>
      resolveCompAccess(V.bianca, { id: V.ana.employeeId, departmentId: DEPT.exec }, tx),
    );
    expect(ok).toBe(false);
  });
});

describe("audit log is append-only for the app role", () => {
  it("hris_app may INSERT but not UPDATE/DELETE the audit log", async () => {
    const [priv] = await prisma.$queryRaw`
      SELECT
        has_table_privilege(current_user, '"EmployeeAuditLog"', 'INSERT') AS can_insert,
        has_table_privilege(current_user, '"EmployeeAuditLog"', 'UPDATE') AS can_update,
        has_table_privilege(current_user, '"EmployeeAuditLog"', 'DELETE') AS can_delete`;
    expect(priv.can_insert).toBe(true);
    expect(priv.can_update).toBe(false);
    expect(priv.can_delete).toBe(false);
  });
});
