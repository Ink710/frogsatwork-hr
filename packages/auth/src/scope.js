// DB-backed scope helpers. These walk the reporting tree with recursive SQL and assemble
// the `ctx` that the pure decisions in roles.js need.
//
// Phase C note: once RLS is enabled, these recursive reads (run as the restricted role)
// must NOT be filtered by RLS or they'd compute the wrong scope. Phase C swaps the inline
// CTEs below for calls to a SECURITY DEFINER SQL function that bypasses RLS. For now
// (pre-RLS) the inline CTEs are correct and simplest.
import { prisma } from "@hris/database";
import { canViewCompensation, isHrRole, isPayroll } from "./roles.js";

// All employee ids in a manager's subtree (the root included).
export async function getSubtreeIds(rootEmployeeId) {
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Employee" WHERE id = ${rootEmployeeId}
      UNION ALL
      SELECT e.id FROM "Employee" e JOIN tree t ON e."managerId" = t.id
    )
    SELECT id FROM tree
  `;
  return new Set(rows.map((r) => r.id));
}

// The viewer's superiors — every manager up the chain (self excluded).
export async function getAncestorIds(employeeId) {
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE chain AS (
      SELECT id, "managerId" FROM "Employee" WHERE id = ${employeeId}
      UNION ALL
      SELECT e.id, e."managerId" FROM "Employee" e JOIN chain c ON e.id = c."managerId"
    )
    SELECT id FROM chain WHERE id <> ${employeeId}
  `;
  return new Set(rows.map((r) => r.id));
}

// Depth in the reporting tree = number of ancestors (used as the "level" proxy).
export async function getDepth(employeeId) {
  return (await getAncestorIds(employeeId)).size;
}

// Precompute exactly what canViewCompensation() needs for this viewer's role.
export async function getCompContext(viewer) {
  if (isPayroll(viewer.role)) return {};
  if (isHrRole(viewer.role)) {
    const [ancestorIds, me] = await Promise.all([
      getAncestorIds(viewer.employeeId),
      prisma.employee.findUnique({
        where: { id: viewer.employeeId },
        select: { departmentId: true },
      }),
    ]);
    return { ancestorIds, viewerDepth: ancestorIds.size, viewerDeptId: me?.departmentId };
  }
  // MANAGER / EMPLOYEE: downward scope.
  return { subtreeIds: await getSubtreeIds(viewer.employeeId) };
}

// Ergonomic async wrapper for a single target (used by the profile page). Assembles the
// context, fills in the target's depth only when the HR rule needs it, then defers to the
// pure decision.
export async function resolveCompAccess(viewer, target) {
  const ctx = await getCompContext(viewer);
  let evaluated = target;
  if (isHrRole(viewer.role)) {
    evaluated = { ...target, depth: await getDepth(target.id) };
  }
  return canViewCompensation(viewer, evaluated, ctx);
}
