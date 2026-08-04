import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

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
  return { getT: async () => t, getLocale: async () => "en", getTimeZone: async () => "America/Mexico_City" };
});
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

import { getViewer, withViewer } from "@hris/auth";
import { createProject, assignToProject, unassignFromProject, toggleProjectStatus } from "../app/projects/actions.js";
import { getManagedProjects, getMyProjects, getProjectForManage } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  // Bianca's row is in People & Culture — here a plain EMPLOYEE OUTSIDE Marcus's Engineering subtree.
  peopleEmp: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "EMPLOYEE", orgId: ORG },
};
const asMgr = (fn) => withViewer(V.marcus, fn);

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.set(k, String(v));
  return fd;
}
async function run(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e.__redirect) return { redirect: e.message };
    throw e;
  }
}
const create = (fields) => run(createProject(undefined, form(fields)));
const projectByName = (name) => asMgr((tx) => tx.project.findFirst({ where: { name } }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("createProject / getManagedProjects", () => {
  it("a manager creates a project they own; an employee cannot", async () => {
    getViewer.mockResolvedValue(V.marcus);
    expect((await create({ name: "Data Pipeline", code: "DP" })).redirect).toBe("REDIRECT:/projects");
    const p = await projectByName("Data Pipeline");
    expect(p.createdById).toBe(V.marcus.userId);
    expect(p.status).toBe("ACTIVE");

    const managed = await getManagedProjects();
    expect(managed.map((m) => m.name)).toContain("Data Pipeline");

    getViewer.mockResolvedValue(V.diego);
    expect((await create({ name: "Sneaky" })).error).toBeTruthy();
    expect(await getManagedProjects()).toBeNull(); // employee: no management view
  });
});

describe("assignments + the employee picker", () => {
  it("a manager assigns a report; the report then sees it in their picker; a non-report is rejected", async () => {
    getViewer.mockResolvedValue(V.marcus);
    await create({ name: "Data Pipeline", code: "DP" });
    const project = await projectByName("Data Pipeline");

    // Assign Diego (subtree) → ok; Diego's picker now includes it.
    expect((await assignToProject(project.id, undefined, form({ employeeId: V.diego.employeeId }))).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyProjects()).map((p) => p.id)).toContain(project.id);

    // A manager cannot assign an employee outside their subtree.
    getViewer.mockResolvedValue(V.marcus);
    expect((await assignToProject(project.id, undefined, form({ employeeId: V.peopleEmp.employeeId }))).error).toBeTruthy();
    // Duplicate assignment is refused.
    expect((await assignToProject(project.id, undefined, form({ employeeId: V.diego.employeeId }))).error).toBeTruthy();
  });

  it("archiving a project drops it from the picker but keeps the assignment; unassign removes it", async () => {
    getViewer.mockResolvedValue(V.marcus);
    await create({ name: "Data Pipeline" });
    const project = await projectByName("Data Pipeline");
    await assignToProject(project.id, undefined, form({ employeeId: V.diego.employeeId }));

    // Archive → Diego's ACTIVE-only picker no longer shows it.
    expect((await toggleProjectStatus(project.id, undefined)).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyProjects()).map((p) => p.id)).not.toContain(project.id);

    // Reactivate + unassign.
    getViewer.mockResolvedValue(V.marcus);
    await toggleProjectStatus(project.id, undefined);
    const detail = await getProjectForManage(project.id);
    const assignmentId = detail.assignees.find((a) => a.employeeId === V.diego.employeeId).assignmentId;
    expect((await unassignFromProject(project.id, assignmentId, undefined)).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyProjects()).map((p) => p.id)).not.toContain(project.id);
  });
});

describe("getProjectForManage scoping", () => {
  it("HR manages any project; a manager only their own; candidates are RLS-scoped", async () => {
    // Marcus creates + Diego is a candidate (subtree).
    getViewer.mockResolvedValue(V.marcus);
    await create({ name: "Data Pipeline" });
    const project = await projectByName("Data Pipeline");
    const mgrView = await getProjectForManage(project.id);
    expect(mgrView.candidates.map((c) => c.id)).toContain(V.diego.employeeId);
    expect(mgrView.candidates.map((c) => c.id)).not.toContain(V.peopleEmp.employeeId); // out of subtree

    // A different manager (none here) — use an employee: null. HR: sees it.
    getViewer.mockResolvedValue(V.diego);
    expect(await getProjectForManage(project.id)).toBeNull();
    getViewer.mockResolvedValue(V.ana);
    expect((await getProjectForManage(project.id)).project.name).toBe("Data Pipeline");
  });
});
