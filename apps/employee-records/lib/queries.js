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
} from "@hris/auth";
import { isWithinCorrectionWindow, CORRECTION_WINDOW_DAYS } from "@hris/types";

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
