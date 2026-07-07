// PURE role logic — no DB, no async. Given a viewer (+ precomputed context), decide what
// they may see. Kept pure so it's trivially unit-testable and reusable in UI and RLS setup.
import { Role } from "@hris/database";

// Record (row) visibility scope. Drives the RLS session variables in Phase C.
export const RECORD_SCOPE = { ALL: "ALL", SUBTREE: "SUBTREE", SELF: "SELF" };

const ALL_RECORDS_ROLES = new Set([
  Role.HR_ADMIN,
  Role.HR_GENERALIST,
  Role.PAYROLL_ADMIN,
  Role.SYSTEM,
]);

export function isPayroll(role) {
  return role === Role.PAYROLL_ADMIN;
}

export function isHrRole(role) {
  return role === Role.HR_ADMIN || role === Role.HR_GENERALIST;
}

// Which employee RECORDS this viewer can see at all.
export function getRecordScope(viewer) {
  if (ALL_RECORDS_ROLES.has(viewer.role)) return RECORD_SCOPE.ALL;
  if (viewer.role === Role.MANAGER) return RECORD_SCOPE.SUBTREE;
  return RECORD_SCOPE.SELF; // EMPLOYEE
}

// ---- Write authorization (record scope is still enforced by RLS on top of these) ----

// May record non-comp effective-dated changes + name/email corrections.
export function canEditEmployee(viewer) {
  return viewer.role === Role.HR_ADMIN || viewer.role === Role.HR_GENERALIST;
}

// May change (or correct) salary. Segregated from other edits per policy.
export function canEditCompensation(viewer) {
  return viewer.role === Role.HR_ADMIN || viewer.role === Role.PAYROLL_ADMIN;
}

// May terminate / rehire — the most sensitive lifecycle actions.
export function canTerminate(viewer) {
  return viewer.role === Role.HR_ADMIN;
}
export const canRehire = canTerminate;

// May change global app settings (e.g. the storage folder). HR_ADMIN only.
export function canManageSettings(viewer) {
  return viewer.role === Role.HR_ADMIN;
}

// May create / edit / delete departments and set heads + budgets. HR_ADMIN only.
export function canManageDepartments(viewer) {
  return viewer.role === Role.HR_ADMIN;
}

// Whether the viewer may see a department's budget. `department` = { id, headUserId };
// `viewerDeptId` is the viewer's own department id.
//   HR_ADMIN / PAYROLL_ADMIN → all departments
//   HR_GENERALIST            → all EXCEPT their own (conflict-of-interest exclusion)
//   MANAGER                  → only their own department (member of, or head of)
//   EMPLOYEE                 → none
export function canViewBudget(viewer, department, viewerDeptId) {
  switch (viewer.role) {
    case Role.HR_ADMIN:
    case Role.PAYROLL_ADMIN:
      return true;
    case Role.HR_GENERALIST:
      return department.id !== viewerDeptId;
    case Role.MANAGER:
      return department.id === viewerDeptId || department.headUserId === viewer.userId;
    default:
      return false;
  }
}

// Whether this viewer may see the COMPENSATION of `target`. Pure: all the data-dependent
// bits (subtree/ancestor sets, depths, department) are precomputed into `ctx` by scope.js.
//   ctx for MANAGER/EMPLOYEE: { subtreeIds: Set }
//   ctx for HR_ADMIN/HR_GENERALIST: { ancestorIds: Set, viewerDepth, viewerDeptId }
//   ctx for PAYROLL_ADMIN: {}  (sees all — audited at the call site)
//   target: { id, departmentId, depth }
export function canViewCompensation(viewer, target, ctx) {
  // Everyone can see their own pay.
  if (target.id === viewer.employeeId) return true;

  switch (viewer.role) {
    case Role.PAYROLL_ADMIN:
      return true; // org-wide; caller writes an audit entry

    // Managers and employees: strictly downward (self + reporting subtree).
    case Role.MANAGER:
    case Role.EMPLOYEE:
      return ctx.subtreeIds?.has(target.id) ?? false;

    // HR: everyone EXCEPT their own superiors (ancestors) and peers
    // (same department AND same reporting-tree depth).
    case Role.HR_ADMIN:
    case Role.HR_GENERALIST: {
      const isSuperior = ctx.ancestorIds?.has(target.id) ?? false;
      const isPeer =
        target.departmentId === ctx.viewerDeptId && target.depth === ctx.viewerDepth;
      return !isSuperior && !isPeer;
    }

    default:
      return false; // SYSTEM and anything unknown: no UI comp access
  }
}
