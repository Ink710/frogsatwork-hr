// PURE role logic — no DB, no async. Given a viewer (+ precomputed context), decide what
// they may see. Kept pure so it's trivially unit-testable and reusable in UI and RLS setup.
import { Role } from "@hris/database";

// The compact "who is asking" shape the whole system passes around (produced by
// getViewer in session.js). `employeeId` is nullable because some actors — SYSTEM,
// or an HR user with no employee record — have a user account but no employee row.
// `Role` is imported from @hris/database as BOTH a value (Role.HR_ADMIN below) and a
// type (here) — Prisma generates both under the same name.
export type Viewer = {
  userId: string;
  employeeId: string | null;
  role: Role;
  orgId: string;
};

// The precomputed data canViewCompensation() needs, assembled per-role by scope.js.
// Every field is optional because which ones are present depends on the viewer's role
// (managers get subtreeIds; HR gets ancestorIds + viewer depth/dept; payroll gets none).
export type CompContext = {
  subtreeIds?: Set<string>;
  ancestorIds?: Set<string>;
  viewerDepth?: number;
  viewerDeptId?: string | null;
};

// The employee whose compensation visibility is being decided.
export type CompTarget = { id: string; departmentId?: string | null; depth?: number };

// Record (row) visibility scope. Drives the RLS session variables in Phase C.
// `as const` freezes the values to string LITERALS so RecordScope is the exact union
// "ALL" | "SUBTREE" | "SELF" rather than the widened `string`.
export const RECORD_SCOPE = { ALL: "ALL", SUBTREE: "SUBTREE", SELF: "SELF" } as const;
export type RecordScope = (typeof RECORD_SCOPE)[keyof typeof RECORD_SCOPE];

// Annotated Set<Role> (not the inferred narrow union of these 4) so `.has(viewer.role)`
// accepts ANY Role — Set.has is invariant on its element type.
const ALL_RECORDS_ROLES = new Set<Role>([
  Role.HR_ADMIN,
  Role.HR_GENERALIST,
  Role.PAYROLL_ADMIN,
  Role.SYSTEM,
]);

export function isPayroll(role: Role) {
  return role === Role.PAYROLL_ADMIN;
}

export function isHrRole(role: Role) {
  return role === Role.HR_ADMIN || role === Role.HR_GENERALIST;
}

// Which employee RECORDS this viewer can see at all.
export function getRecordScope(viewer: Viewer) {
  if (ALL_RECORDS_ROLES.has(viewer.role)) return RECORD_SCOPE.ALL;
  if (viewer.role === Role.MANAGER) return RECORD_SCOPE.SUBTREE;
  return RECORD_SCOPE.SELF; // EMPLOYEE
}

// ---- Write authorization (record scope is still enforced by RLS on top of these) ----

// May record non-comp effective-dated changes + name/email corrections.
export function canEditEmployee(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN || viewer.role === Role.HR_GENERALIST;
}

// May change (or correct) salary. Segregated from other edits per policy.
export function canEditCompensation(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN || viewer.role === Role.PAYROLL_ADMIN;
}

// May terminate / rehire — the most sensitive lifecycle actions.
export function canTerminate(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN;
}
export const canRehire = canTerminate;

// May change global app settings (e.g. the storage folder). HR_ADMIN only.
export function canManageSettings(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN;
}

// May create / edit / delete departments and set heads + budgets. HR_ADMIN only.
export function canManageDepartments(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN;
}

// Whether the viewer may see a department's budget. `department` = { id, headUserId };
// `viewerDeptId` is the viewer's own department id.
//   HR_ADMIN / PAYROLL_ADMIN → all departments
//   HR_GENERALIST            → all EXCEPT their own (conflict-of-interest exclusion)
//   MANAGER                  → only their own department (member of, or head of)
//   EMPLOYEE                 → none
export function canViewBudget(
  viewer: Viewer,
  department: { id: string; headUserId?: string | null },
  viewerDeptId: string | null,
) {
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

// May see the COMPANY-WIDE budget overview — every department's budget at once (the dashboard
// pie). Restricted to the roles that already have full budget visibility via canViewBudget, so
// the overview never reveals a budget the viewer isn't otherwise entitled to.
export function canViewBudgetOverview(viewer: Viewer) {
  return viewer.role === Role.HR_ADMIN || viewer.role === Role.PAYROLL_ADMIN;
}

// Whether this viewer may see the COMPENSATION of `target`. Pure: all the data-dependent
// bits (subtree/ancestor sets, depths, department) are precomputed into `ctx` by scope.js.
//   ctx for MANAGER/EMPLOYEE: { subtreeIds: Set }
//   ctx for HR_ADMIN/HR_GENERALIST: { ancestorIds: Set, viewerDepth, viewerDeptId }
//   ctx for PAYROLL_ADMIN: {}  (sees all — audited at the call site)
//   target: { id, departmentId, depth }
export function canViewCompensation(viewer: Viewer, target: CompTarget, ctx: CompContext) {
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
