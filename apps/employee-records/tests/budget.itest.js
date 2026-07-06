import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@hris/database";
import { withViewer } from "../../../packages/auth/src/rls.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};
const DEPT = {
  exec: "20000000-0000-0000-0000-000000000001",
  eng: "20000000-0000-0000-0000-000000000002",
  people: "20000000-0000-0000-0000-000000000003", // Bianca's own department
};

afterAll(async () => {
  await prisma.$disconnect();
});

const visibleDeptIds = (viewer) =>
  withViewer(viewer, async (tx) => {
    const rows = await tx.departmentBudget.findMany({ select: { departmentId: true } });
    return new Set(rows.map((r) => r.departmentId));
  });

describe("DepartmentBudget RLS (the DB-level budget wall)", () => {
  it("no session sees no budgets", async () => {
    expect(await prisma.departmentBudget.findMany()).toHaveLength(0);
  });

  it("HR_ADMIN sees all 3 department budgets", async () => {
    expect((await visibleDeptIds(V.ana)).size).toBe(3);
  });

  it("HR_GENERALIST sees all EXCEPT their own department", async () => {
    const seen = await visibleDeptIds(V.bianca);
    expect(seen.size).toBe(2);
    expect(seen.has(DEPT.people)).toBe(false); // Bianca's own → hidden by the DB
    expect(seen.has(DEPT.eng)).toBe(true);
    expect(seen.has(DEPT.exec)).toBe(true);
  });

  it("MANAGER sees only their own department (which they head)", async () => {
    const seen = await visibleDeptIds(V.marcus);
    expect(seen.size).toBe(1);
    expect(seen.has(DEPT.eng)).toBe(true);
  });

  it("EMPLOYEE sees no budgets at all", async () => {
    expect((await visibleDeptIds(V.diego)).size).toBe(0);
  });
});
