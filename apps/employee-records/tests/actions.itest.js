import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@hris/database";
import { resetDb } from "../../../test/resetDb.js";

// --- Mock only the thin wrappers; keep all real logic (withViewer, RLS, predicates) ---
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls.js");
  const roles = await import("../../../packages/auth/src/roles.js");
  const scope = await import("../../../packages/auth/src/scope.js");
  return {
    getViewer: vi.fn(), // set per test
    withViewer: rls.withViewer,
    getSubtreeIds: scope.getSubtreeIds,
    canEditEmployee: roles.canEditEmployee,
    canEditCompensation: roles.canEditCompensation,
    canTerminate: roles.canTerminate,
    canRehire: roles.canRehire,
  };
});

import { getViewer } from "@hris/auth";
import { withViewer } from "@hris/auth";
import {
  recordChange,
  correctIdentity,
  correctMaterial,
  terminateEmployee,
  rehireEmployee,
  createEmployee,
} from "../app/employees/[id]/actions.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
};
const ID = {
  marcus: "40000000-0000-0000-0000-000000000002",
  diego: "40000000-0000-0000-0000-000000000004",
  priya: "40000000-0000-0000-0000-000000000005",
};
const DEPT_ENG = "20000000-0000-0000-0000-000000000002";
const today = () => new Date().toLocaleDateString("en-CA");

// Run an action; on success it redirects (throws __redirect) → { ok:true }; on failure it
// returns { error }.
async function invoke(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e?.__redirect) return { ok: true };
    throw e;
  }
}

// Assertion helpers read through an HR viewer (sees everything).
const openRows = (empId) =>
  withViewer(V.ana, (tx) => tx.employeeHistory.count({ where: { employeeId: empId, effectiveTo: null } }));
const versionCount = (empId) =>
  withViewer(V.ana, (tx) => tx.employeeHistory.count({ where: { employeeId: empId } }));
const auditCount = (empId, eventType) =>
  withViewer(V.ana, (tx) => tx.employeeAuditLog.count({ where: { employeeId: empId, eventType } }));

function changeForm(overrides = {}) {
  const fd = new FormData();
  fd.set("jobTitle", "Senior Software Engineer");
  fd.set("employmentType", "FULL_TIME");
  fd.set("departmentId", DEPT_ENG);
  fd.set("effectiveFrom", today());
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
  getViewer.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordChange (effective-dated)", () => {
  it("HR records a title change → new version, one open row, UPDATE audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(recordChange(ID.priya, {}, changeForm()));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(2);
    expect(await openRows(ID.priya)).toBe(1);
    expect(await auditCount(ID.priya, "UPDATE")).toBe(1);
  });

  it("HR_GENERALIST cannot change salary; PAYROLL/HR_ADMIN can", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const denied = await invoke(recordChange(ID.priya, {}, changeForm({ salary: "150000" })));
    expect(denied.error).toMatch(/compensation/i);
    expect(await versionCount(ID.priya)).toBe(1); // nothing written

    getViewer.mockResolvedValue(V.ana);
    const ok = await invoke(recordChange(ID.priya, {}, changeForm({ salary: "150000" })));
    expect(ok.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(2);
  });

  it("rejects a backdated effective date", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(recordChange(ID.priya, {}, changeForm({ effectiveFrom: "2020-01-01" })));
    expect(r.error).toBeTruthy();
    expect(await versionCount(ID.priya)).toBe(1);
  });

  it("rejects a manager reassignment that creates a cycle", async () => {
    getViewer.mockResolvedValue(V.ana);
    // Make Diego (Marcus's report) Marcus's manager → cycle.
    const r = await invoke(recordChange(ID.marcus, {}, changeForm({ managerId: ID.diego })));
    expect(r.error).toMatch(/cycle|reports/i);
  });
});

describe("corrections", () => {
  it("material correction amends in place (no new version) within the window", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("jobTitle", "Software Engineer II");
    const r = await invoke(correctMaterial(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(1); // amended, NOT a new version
    expect(await auditCount(ID.priya, "CORRECTION")).toBe(1);
  });

  it("material correction is rejected once the version ages past the window", async () => {
    // Backdate the open version's createdAt beyond 7 days (owner).
    await withViewer(V.ana, async (tx) => {
      await tx.$executeRaw`UPDATE "EmployeeHistory" SET "createdAt" = now() - interval '10 days'
        WHERE "employeeId" = ${ID.priya} AND "effectiveTo" IS NULL`;
    });
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("jobTitle", "Too Late");
    const r = await invoke(correctMaterial(ID.priya, {}, fd));
    expect(r.error).toMatch(/window/i);
  });

  it("identity correction updates name, no new version, CORRECTION audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("firstName", "Priyanka");
    fd.set("lastName", "Nair");
    fd.set("email", "priya.nair@peoplebase.test");
    const r = await invoke(correctIdentity(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(1);
    expect(await auditCount(ID.priya, "CORRECTION")).toBe(1);
  });
});

describe("terminate + rehire", () => {
  function termForm(eligible = true) {
    const fd = new FormData();
    fd.set("terminationDate", today());
    fd.set("terminationReason", "Role eliminated");
    if (eligible) fd.set("eligibleForRehire", "on");
    return fd;
  }

  it("only HR_ADMIN can terminate", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const denied = await invoke(terminateEmployee(ID.priya, {}, termForm()));
    expect(denied.error).toMatch(/authorized/i);
  });

  it("terminate closes the open version; rehire reopens one", async () => {
    getViewer.mockResolvedValue(V.ana);
    expect((await invoke(terminateEmployee(ID.priya, {}, termForm()))).ok).toBe(true);
    expect(await openRows(ID.priya)).toBe(0); // no active version while terminated

    const fd = new FormData();
    fd.set("rehireDate", today());
    expect((await invoke(rehireEmployee(ID.priya, {}, fd))).ok).toBe(true);
    expect(await openRows(ID.priya)).toBe(1); // invariant restored
    expect(await auditCount(ID.priya, "REHIRE")).toBe(1);
  });

  it("rehire is blocked when the employee is not eligible", async () => {
    getViewer.mockResolvedValue(V.ana);
    await invoke(terminateEmployee(ID.priya, {}, termForm(false))); // ineligible
    const fd = new FormData();
    fd.set("rehireDate", today());
    const r = await invoke(rehireEmployee(ID.priya, {}, fd));
    expect(r.error).toMatch(/eligible/i);
  });
});

describe("createEmployee", () => {
  function createForm(overrides = {}) {
    const fd = new FormData();
    fd.set("firstName", "Ada");
    fd.set("lastName", "Lovelace");
    fd.set("email", `ada+${Math.floor(Math.random() * 1e6)}@peoplebase.test`);
    fd.set("hireDate", today());
    fd.set("departmentId", DEPT_ENG);
    fd.set("jobTitle", "Software Engineer");
    fd.set("employmentType", "FULL_TIME");
    fd.set("role", "EMPLOYEE");
    // Required at hire (the "at least one emergency contact" invariant).
    fd.set("emergencyContactName", "Grace Hopper");
    fd.set("emergencyContactRelationship", "Spouse");
    fd.set("emergencyContactPhone", "+1-555-0100");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }
  // Find a just-created employee by email (through an HR viewer, which sees everyone).
  const findByEmail = (email) =>
    withViewer(V.ana, (tx) =>
      tx.employee.findFirst({
        where: { email },
        select: { id: true, employeeNumber: true, history: { select: { version: true, salary: true, effectiveTo: true } } },
      }),
    );

  it("HR_ADMIN creates an employee with salary → record + v1 + user", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = createForm({ salary: "125000" });
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);

    const emp = await findByEmail(email);
    expect(emp).toBeTruthy();
    expect(emp.employeeNumber).toMatch(/^E-\d{4}$/);
    expect(emp.history).toHaveLength(1);
    expect(emp.history[0].version).toBe(1);
    expect(emp.history[0].effectiveTo).toBeNull(); // exactly one open version
    expect(emp.history[0].salary.toString()).toBe("125000");
  });

  it("HR_GENERALIST creates → salary defaults to 0 (no comp rights)", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const fd = createForm({ salary: "999999" }); // ignored — generalist can't set pay
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);
    const emp = await findByEmail(email);
    expect(emp.history[0].salary.toString()).toBe("0");
  });

  it("a MANAGER cannot create employees", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const r = await invoke(createEmployee({}, createForm()));
    expect(r.error).toMatch(/authorized/i);
  });
});
