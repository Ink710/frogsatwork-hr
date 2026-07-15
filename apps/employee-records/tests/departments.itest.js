import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@hris/database";
import { resetDb } from "../../../test/resetDb.js";

// Same harness as actions.itest.js, scoped to department management (needs canManageDepartments).
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  return {
    getViewer: vi.fn(),
    withViewer: rls.withViewer,
    canManageDepartments: roles.canManageDepartments,
  };
});

import { getViewer, withViewer } from "@hris/auth";
import { createDepartment, updateDepartment, deleteDepartment } from "../app/departments/actions.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
};
// Seeded departments: Executive (root) → { Engineering, People & Culture }.
const DEPT = {
  exec: "20000000-0000-0000-0000-000000000001",
  eng: "20000000-0000-0000-0000-000000000002",
  people: "20000000-0000-0000-0000-000000000003",
};

async function invoke(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e?.__redirect) return { ok: true };
    throw e;
  }
}

function deptForm(overrides = {}) {
  const fd = new FormData();
  fd.set("name", "New Team");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}
const deptByName = (name) => withViewer(V.ana, (tx) => tx.department.findFirst({ where: { name } }));
const budgetOf = (deptId) => withViewer(V.ana, (tx) => tx.departmentBudget.findUnique({ where: { departmentId: deptId } }));

beforeEach(async () => {
  await resetDb();
  getViewer.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("department management", () => {
  it("HR_ADMIN creates a department with a budget", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(createDepartment({}, deptForm({ name: "Design", budget: "500000" })));
    expect(r.ok).toBe(true);
    const d = await deptByName("Design");
    expect(d).toBeTruthy();
    expect((await budgetOf(d.id)).budget.toString()).toBe("500000");
  });

  it("non-HR_ADMIN (generalist, manager) cannot manage departments", async () => {
    for (const v of [V.bianca, V.marcus]) {
      getViewer.mockResolvedValue(v);
      const r = await invoke(createDepartment({}, deptForm({ name: "Nope" })));
      expect(r.error).toMatch(/authorized/i);
    }
    expect(await deptByName("Nope")).toBeNull();
  });

  it("update renames + upserts a budget; clearing the budget removes the row", async () => {
    getViewer.mockResolvedValue(V.ana);
    await invoke(updateDepartment(DEPT.people, {}, deptForm({ name: "People Ops", budget: "900000" })));
    expect((await budgetOf(DEPT.people)).budget.toString()).toBe("900000");

    // Omitting the budget clears it (DepartmentBudget is NOT NULL → the row is deleted).
    await invoke(updateDepartment(DEPT.people, {}, deptForm({ name: "People Ops" })));
    expect(await budgetOf(DEPT.people)).toBeNull();
  });

  it("rejects a parent that would create a cycle (self or descendant)", async () => {
    getViewer.mockResolvedValue(V.ana);
    // Engineering is under Executive, so making Executive's parent Engineering is a cycle.
    const r = await invoke(updateDepartment(DEPT.exec, {}, deptForm({ name: "Executive", parentDepartmentId: DEPT.eng })));
    expect(r.error).toMatch(/nested|itself|sub-department/i);
  });

  it("deletes an empty department but refuses one with employees", async () => {
    getViewer.mockResolvedValue(V.ana);
    // Engineering has employees → refuse.
    expect((await invoke(deleteDepartment(DEPT.eng, {}))).error).toMatch(/reassign/i);

    // A fresh, empty department deletes cleanly.
    await invoke(createDepartment({}, deptForm({ name: "Temp" })));
    const temp = await deptByName("Temp");
    expect((await invoke(deleteDepartment(temp.id, {}))).ok).toBe(true);
    expect(await deptByName("Temp")).toBeNull();
  });
});
