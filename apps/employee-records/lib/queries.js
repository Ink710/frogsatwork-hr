import { cache } from "react";
import {
  getViewer,
  withViewer,
  resolveCompAccess,
  isPayroll,
  canEditEmployee,
  canEditCompensation,
  getSubtreeIds,
  canTerminate,
  canViewBudget,
} from "@hris/auth";
import { isWithinCorrectionWindow, CORRECTION_WINDOW_DAYS } from "@hris/types";
import { buildTree } from "./tree.js";

// Data access for the employee list. Every read now runs inside withViewer(), so RLS
// scopes the rows to the signed-in user automatically — no manual `where` filtering, and
// no way to forget it. Compensation is still never selected here.
export async function getEmployees() {
  const viewer = await getViewer();
  if (!viewer) return [];

  const rows = await withViewer(viewer, (tx) =>
    tx.employee.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        department: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
        history: {
          where: { effectiveTo: null },
          select: { jobTitle: true, employmentType: true },
          take: 1,
        },
      },
    }),
  );

  return rows.map((e) => ({
    id: e.id,
    employeeNumber: e.employeeNumber,
    name: `${e.firstName} ${e.lastName}`,
    department: e.department?.name ?? "—",
    manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : "—",
    title: e.history[0]?.jobTitle ?? "—",
    employmentType: e.history[0]?.employmentType ?? "—",
    status: e.employmentStatus,
  }));
}

// Single employee for the profile page. Wrapped in cache() so the page body and
// generateMetadata share one execution per request (and one payroll audit entry).
export const getEmployeeProfile = cache(async (id) => {
  const viewer = await getViewer();
  if (!viewer) return null;

  return withViewer(viewer, async (tx) => {
    // Everything EXCEPT salary. If the employee isn't visible to this viewer, RLS makes
    // this return null and we 404.
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        employmentStatus: true,
        hireDate: true,
        terminationDate: true,
        terminationReason: true,
        eligibleForRehire: true,
        rehireDate: true,
        departmentId: true, // needed for the HR peer comp check
        department: { select: { name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        reports: {
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        },
        emergencyContacts: {
          select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
          orderBy: { isPrimary: "desc" },
        },
        history: {
          select: {
            id: true,
            version: true,
            jobTitle: true,
            employmentType: true,
            departmentSnapshot: true,
            managerSnapshot: true,
            changeReason: true,
            changedFields: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
          orderBy: { version: "desc" },
        },
      },
    });
    if (!employee) return null;

    // Column-level comp guard: decide, then fetch salary only if allowed.
    const canViewComp = await resolveCompAccess(
      viewer,
      { id: employee.id, departmentId: employee.departmentId },
      tx,
    );

    if (canViewComp) {
      const comp = await tx.employeeHistory.findMany({
        where: { employeeId: id },
        select: { id: true, salary: true, currency: true },
      });
      const byId = new Map(comp.map((c) => [c.id, c]));
      employee.history = employee.history.map((h) => ({
        ...h,
        salary: byId.get(h.id)?.salary?.toString() ?? null,
        currency: byId.get(h.id)?.currency ?? null,
      }));

      // Payroll's broad comp access is logged. occurredAt is DB-defaulted; hris_app has
      // INSERT-only on this table.
      if (isPayroll(viewer.role)) {
        await tx.employeeAuditLog.create({
          data: {
            employeeId: id,
            eventType: "VIEW",
            actorType: "USER",
            actorId: viewer.userId,
          },
        });
      }
    }

    return { ...employee, canViewComp };
  });
});

// Prefill data for the "record a change" form. Returns null if the viewer may not edit
// (also gates the route). Manager candidates exclude the employee's own subtree so a
// reassignment can't create a reporting cycle.
export async function getEmployeeForEdit(id) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;
  const canEditComp = canEditCompensation(viewer);

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        managerId: true,
        employmentStatus: true,
      },
    });
    if (!employee) return null;

    const current = await tx.employeeHistory.findFirst({
      where: { employeeId: id, effectiveTo: null },
      orderBy: { version: "desc" },
      select: {
        jobTitle: true,
        employmentType: true,
        currency: true,
        effectiveFrom: true,
        ...(canEditComp ? { salary: true } : {}),
      },
    });

    const [departments, subtree, all] = await Promise.all([
      tx.department.findMany({
        where: { orgId: viewer.orgId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      getSubtreeIds(id, tx),
      tx.employee.findMany({
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);

    const managerOptions = all
      .filter((e) => !subtree.has(e.id)) // excludes self + descendants → no cycles
      .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }));

    return {
      employee,
      current: current ? { ...current, salary: current.salary?.toString() ?? null } : null,
      departments,
      managerOptions,
      canEditComp,
    };
  });
}

// Prefill + window status for the "Correct data" page.
export async function getEmployeeForCorrection(id) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;
  const canEditComp = canEditCompensation(viewer);

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        departmentId: true,
        managerId: true,
      },
    });
    if (!employee) return null;

    const current = await tx.employeeHistory.findFirst({
      where: { employeeId: id, effectiveTo: null },
      orderBy: { version: "desc" },
      select: {
        jobTitle: true,
        employmentType: true,
        currency: true,
        createdAt: true,
        ...(canEditComp ? { salary: true } : {}),
      },
    });

    const [departments, subtree, all] = await Promise.all([
      tx.department.findMany({
        where: { orgId: viewer.orgId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      getSubtreeIds(id, tx),
      tx.employee.findMany({
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);
    const managerOptions = all
      .filter((e) => !subtree.has(e.id))
      .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }));

    return {
      employee,
      current: current ? { ...current, salary: current.salary?.toString() ?? null } : null,
      // The window is about ENTRY recency (createdAt), not the effective date.
      withinWindow: current ? isWithinCorrectionWindow(current.createdAt) : false,
      windowDays: CORRECTION_WINDOW_DAYS,
      departments,
      managerOptions,
      canEditComp,
    };
  });
}

// Light query for the terminate/rehire pages. Gated to lifecycle managers (HR_ADMIN).
export async function getEmployeeForLifecycle(id) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return null;
  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        eligibleForRehire: true,
      },
    });
    return employee;
  });
}

// Build the org tree from the viewer's RLS-scoped employees. Because findMany is already
// row-filtered, the tree automatically shows only nodes this viewer may see: HR sees the
// whole company, a manager sees their subtree (they become the root), an employee sees
// just themselves. Terminated staff are excluded (the chart is the CURRENT structure).
export async function getOrgTree() {
  const viewer = await getViewer();
  if (!viewer) return [];

  const rows = await withViewer(viewer, (tx) =>
    tx.employee.findMany({
      where: { employmentStatus: { not: "TERMINATED" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        managerId: true,
        department: { select: { name: true } },
        history: { where: { effectiveTo: null }, select: { jobTitle: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  );

  // Roots = nodes whose manager isn't in the visible set (see buildTree).
  return buildTree(
    rows.map((r) => ({
      id: r.id,
      managerId: r.managerId,
      name: `${r.firstName} ${r.lastName}`,
      initials: `${r.firstName[0] ?? ""}${r.lastName[0] ?? ""}`.toUpperCase(),
      title: r.history[0]?.jobTitle ?? "—",
      department: r.department?.name ?? null,
    })),
  );
}

// Aggregations for the HR dashboard. Every count is computed from the viewer's RLS-scoped
// employees, so the dashboard auto-scopes: HR sees the whole org, a manager sees their
// team's numbers. Compensation aggregates are intentionally omitted (sensitive).
export async function getDashboardStats() {
  const viewer = await getViewer();
  if (!viewer) return null;

  const rows = await withViewer(viewer, (tx) =>
    tx.employee.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        hireDate: true,
        terminationDate: true,
        managerId: true,
        department: { select: { name: true } },
        history: { where: { effectiveTo: null }, select: { employmentType: true }, take: 1 },
      },
    }),
  );

  const thisYear = new Date().getFullYear();
  const nameById = new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

  const byStatus = {};
  const byType = {};
  const byDept = {};
  const reports = {}; // managerId -> active direct-report count
  let newHires = 0;
  let terminations = 0;

  for (const r of rows) {
    byStatus[r.employmentStatus] = (byStatus[r.employmentStatus] ?? 0) + 1;
    if (r.hireDate && new Date(r.hireDate).getFullYear() === thisYear) newHires += 1;
    if (r.terminationDate && new Date(r.terminationDate).getFullYear() === thisYear) terminations += 1;

    if (r.employmentStatus !== "TERMINATED") {
      const t = r.history[0]?.employmentType ?? "UNKNOWN";
      byType[t] = (byType[t] ?? 0) + 1;
      const d = r.department?.name ?? "—";
      byDept[d] = (byDept[d] ?? 0) + 1;
      if (r.managerId && nameById.has(r.managerId)) {
        reports[r.managerId] = (reports[r.managerId] ?? 0) + 1;
      }
    }
  }

  const toSortedPairs = (obj) =>
    Object.entries(obj)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

  const spanOfControl = Object.entries(reports)
    .map(([id, count]) => ({ label: nameById.get(id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const activeHeadcount = rows.filter((r) => r.employmentStatus !== "TERMINATED").length;

  return {
    activeHeadcount,
    departmentCount: Object.keys(byDept).length,
    newHires,
    terminations,
    byDepartment: toSortedPairs(byDept),
    byType: toSortedPairs(byType),
    byStatus: toSortedPairs(byStatus),
    spanOfControl,
  };
}

// Department directory. Gated to non-EMPLOYEE roles. Departments have no RLS so all are
// listed; the per-department headcount is RLS-scoped (what the viewer can see); budget is
// shown only where canViewBudget allows.
export async function getDepartments() {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "EMPLOYEE") return null;

  return withViewer(viewer, async (tx) => {
    const me = viewer.employeeId
      ? await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } })
      : null;
    const viewerDeptId = me?.departmentId ?? null;

    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true, headUserId: true, head: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

    // Budgets come from the RLS'd table: this returns ONLY the rows this viewer may see —
    // the DB is the enforcer. canViewBudget below is just the UI hint (Restricted vs "—").
    const budgetRows = await tx.departmentBudget.findMany({ select: { departmentId: true, budget: true } });
    const budgetByDept = new Map(budgetRows.map((b) => [b.departmentId, b.budget.toString()]));

    const result = [];
    for (const d of departments) {
      const employeeCount = await tx.employee.count({
        where: { departmentId: d.id, employmentStatus: { not: "TERMINATED" } },
      });
      const showBudget = canViewBudget(viewer, { id: d.id, headUserId: d.headUserId }, viewerDeptId);
      result.push({
        id: d.id,
        name: d.name,
        headName: d.head?.name ?? null,
        employeeCount,
        budget: budgetByDept.get(d.id) ?? null, // RLS-authoritative
        budgetHidden: !showBudget,
      });
    }
    return result;
  });
}

// One department: gated budget, RLS-scoped employees + stats, head profile link, and a
// mini org tree restricted to this department's visible members.
export async function getDepartmentDetail(id) {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "EMPLOYEE") return null;

  return withViewer(viewer, async (tx) => {
    const department = await tx.department.findUnique({
      where: { id },
      select: { id: true, name: true, headUserId: true, head: { select: { name: true } } },
    });
    if (!department) return null;

    const me = viewer.employeeId
      ? await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } })
      : null;
    const showBudget = canViewBudget(viewer, { id: department.id, headUserId: department.headUserId }, me?.departmentId ?? null);
    // RLS returns the budget row only if allowed — the DB wall; showBudget is the UI hint.
    const budgetRow = await tx.departmentBudget.findUnique({ where: { departmentId: id }, select: { budget: true } });

    const emps = await tx.employee.findMany({
      where: { departmentId: id, employmentStatus: { not: "TERMINATED" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        managerId: true,
        history: { where: { effectiveTo: null }, select: { jobTitle: true, employmentType: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    // Head's linkable employee (only if visible under RLS).
    let head = null;
    if (department.head) {
      const headEmp = await tx.employee.findFirst({ where: { userId: department.headUserId }, select: { id: true } });
      head = { name: department.head.name, employeeId: headEmp?.id ?? null };
    }

    // Composition by employment type.
    const byType = {};
    for (const e of emps) {
      const t = e.history[0]?.employmentType ?? "UNKNOWN";
      byType[t] = (byType[t] ?? 0) + 1;
    }
    const byTypePairs = Object.entries(byType)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Mini org tree, restricted to this department's visible set (same builder as getOrgTree).
    const tree = buildTree(
      emps.map((e) => ({
        id: e.id,
        managerId: e.managerId,
        name: `${e.firstName} ${e.lastName}`,
        initials: `${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase(),
        title: e.history[0]?.jobTitle ?? "—",
        department: null,
      })),
    );

    return {
      department: {
        id: department.id,
        name: department.name,
        budget: budgetRow?.budget?.toString() ?? null, // RLS-authoritative
        budgetHidden: !showBudget,
      },
      head,
      headcount: emps.length,
      byType: byTypePairs,
      employees: emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, title: e.history[0]?.jobTitle ?? "—" })),
      tree,
    };
  });
}

// Options for the "new employee" form. Gated to HR (also gates the /employees/new route).
export async function getNewEmployeeFormData() {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;

  return withViewer(viewer, async (tx) => {
    const [departments, all] = await Promise.all([
      tx.department.findMany({
        where: { orgId: viewer.orgId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.employee.findMany({
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);
    return {
      departments,
      managerOptions: all.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
      canEditComp: canEditCompensation(viewer),
    };
  });
}
