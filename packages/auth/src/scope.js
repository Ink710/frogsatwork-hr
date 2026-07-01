// DB-backed scope helpers. They assemble the `ctx` that the pure decisions in roles.js
// need.
//
// Each takes an optional `db` client (defaulting to the shared prisma). Pass the
// withViewer transaction (`tx`) when you need the query to run under the caller's RLS
// session — e.g. the HR self-department lookup below only works with session vars set.
//
// The tree walks call SECURITY DEFINER functions (app_subtree / app_ancestors), which
// bypass RLS by design — computing "who is in my subtree" must see the whole tree.
import { prisma } from "@hris/database";
import { canViewCompensation, isHrRole, isPayroll } from "./roles.js";

export async function getSubtreeIds(rootEmployeeId, db = prisma) {
  const rows = await db.$queryRaw`SELECT id FROM app_subtree(${rootEmployeeId})`;
  return new Set(rows.map((r) => r.id));
}

export async function getAncestorIds(employeeId, db = prisma) {
  const rows = await db.$queryRaw`SELECT id FROM app_ancestors(${employeeId})`;
  return new Set(rows.map((r) => r.id));
}

// Depth in the reporting tree = number of ancestors (the "level" proxy).
export async function getDepth(employeeId, db = prisma) {
  return (await getAncestorIds(employeeId, db)).size;
}

// Precompute exactly what canViewCompensation() needs for this viewer's role.
export async function getCompContext(viewer, db = prisma) {
  if (isPayroll(viewer.role)) return {};
  if (isHrRole(viewer.role)) {
    const [ancestorIds, me] = await Promise.all([
      getAncestorIds(viewer.employeeId, db),
      // Reads the viewer's own row — RLS lets HR see it, but only with session vars set,
      // so `db` must be a withViewer transaction here.
      db.employee.findUnique({
        where: { id: viewer.employeeId },
        select: { departmentId: true },
      }),
    ]);
    return { ancestorIds, viewerDepth: ancestorIds.size, viewerDeptId: me?.departmentId };
  }
  // MANAGER / EMPLOYEE: downward scope.
  return { subtreeIds: await getSubtreeIds(viewer.employeeId, db) };
}

// Ergonomic async wrapper for a single target (used by the profile page).
export async function resolveCompAccess(viewer, target, db = prisma) {
  const ctx = await getCompContext(viewer, db);
  let evaluated = target;
  if (isHrRole(viewer.role)) {
    evaluated = { ...target, depth: await getDepth(target.id, db) };
  }
  return canViewCompensation(viewer, evaluated, ctx);
}
