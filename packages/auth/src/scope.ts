// DB-backed scope helpers. They assemble the `ctx` that the pure decisions in roles.js
// need.
//
// Each takes an optional `db` client (defaulting to the shared prisma). Pass the
// withViewer transaction (`tx`) when you need the query to run under the caller's RLS
// session — e.g. the HR self-department lookup below only works with session vars set.
//
// The tree walks call SECURITY DEFINER functions (app_subtree / app_ancestors), which
// bypass RLS by design — computing "who is in my subtree" must see the whole tree.
import { prisma, Prisma } from "@hris/database";
import { canViewCompensation, isHrRole, isPayroll } from "./roles";
import type { Viewer, CompContext, CompTarget } from "./roles";

// These helpers accept EITHER the shared prisma client OR a withViewer transaction
// (`tx`). TransactionClient is the common supertype (it has the model delegates and
// $queryRaw but not $transaction/$connect), so a full client is assignable to it too.
type Db = Prisma.TransactionClient;

export async function getSubtreeIds(rootEmployeeId: string, db: Db = prisma) {
  // $queryRaw returns `unknown` by default — the DB can't tell TS the row shape.
  // The <...> type argument asserts what each row looks like so `.map((r) => r.id)` checks.
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM app_subtree(${rootEmployeeId})`;
  return new Set(rows.map((r) => r.id));
}

export async function getAncestorIds(employeeId: string, db: Db = prisma) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM app_ancestors(${employeeId})`;
  return new Set(rows.map((r) => r.id));
}

// Depth in the reporting tree = number of ancestors (the "level" proxy).
export async function getDepth(employeeId: string, db: Db = prisma) {
  return (await getAncestorIds(employeeId, db)).size;
}

// Precompute exactly what canViewCompensation() needs for this viewer's role.
export async function getCompContext(viewer: Viewer, db: Db = prisma): Promise<CompContext> {
  if (isPayroll(viewer.role)) return {};
  // Viewer.employeeId is nullable (SYSTEM/HR may lack an employee row). Coerce to "" —
  // which matches no employee id — mirroring the rls.ts convention, so a viewer without an
  // employee record simply resolves to an empty scope instead of a type error or a crash.
  const employeeId = viewer.employeeId ?? "";
  if (isHrRole(viewer.role)) {
    const [ancestorIds, me] = await Promise.all([
      getAncestorIds(employeeId, db),
      // Reads the viewer's own row — RLS lets HR see it, but only with session vars set,
      // so `db` must be a withViewer transaction here.
      db.employee.findUnique({
        where: { id: employeeId },
        select: { departmentId: true },
      }),
    ]);
    return { ancestorIds, viewerDepth: ancestorIds.size, viewerDeptId: me?.departmentId };
  }
  // MANAGER / EMPLOYEE: downward scope.
  return { subtreeIds: await getSubtreeIds(employeeId, db) };
}

// Ergonomic async wrapper for a single target (used by the profile page).
export async function resolveCompAccess(viewer: Viewer, target: CompTarget, db: Db = prisma) {
  const ctx = await getCompContext(viewer, db);
  let evaluated: CompTarget = target;
  if (isHrRole(viewer.role)) {
    evaluated = { ...target, depth: await getDepth(target.id, db) };
  }
  return canViewCompensation(viewer, evaluated, ctx);
}
