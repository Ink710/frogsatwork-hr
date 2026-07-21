import "server-only";
import { getViewer, withViewer, isHrRole, getSubtreeIds } from "@hris/auth";
import { computeBalances, pendingHours, canApproveTimeOff, LEAVE_TYPES } from "@hris/workable-hours";

// All reads for the time-management app. Same contract as employee-records/lib/queries: resolve the
// viewer, then run inside withViewer so Postgres RLS scopes every row to what the viewer may see.

// Whose time-off are we showing? Yourself by default; HR may pass another employee's id (used by
// the on-behalf + approvals flows). A non-HR viewer asking for someone else gets null (RLS would
// hide the rows anyway; this fails fast and clearly).
function resolveSubject(viewer, requestedId) {
  if (requestedId && requestedId !== viewer.employeeId) {
    return isHrRole(viewer.role) ? requestedId : null;
  }
  return viewer.employeeId;
}

// Balances (per leave type) + the request history for one employee. Returns null when there's no
// employee to show (e.g. an HR/SYSTEM account with no employee row, or a subject the viewer can't see).
export async function getTimeOffOverview(requestedEmployeeId = null) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const subjectId = resolveSubject(viewer, requestedEmployeeId);
  if (!subjectId) return null;

  return withViewer(viewer, async (tx) => {
    // Sequential awaits (not Promise.all): queries share one tx/connection and can't run concurrently.
    const employee = await tx.employee.findUnique({
      where: { id: subjectId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) return null; // RLS hid the subject → not visible to this viewer

    const ledger = await tx.leaveLedgerEntry.findMany({
      where: { employeeId: subjectId },
      select: { type: true, hours: true },
    });
    const requests = await tx.leaveRequest.findMany({
      where: { employeeId: subjectId },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    const policies = await tx.leavePolicy.findMany(); // org config, no RLS

    const balances = computeBalances(ledger.map((l) => ({ type: l.type, hours: Number(l.hours) })));
    const pending = pendingHours(requests.map((r) => ({ type: r.type, hours: Number(r.hours), status: r.status })));
    const policyByType = Object.fromEntries(policies.map((p) => [p.type, p]));

    return {
      subject: employee,
      isSelf: subjectId === viewer.employeeId,
      canFileOnBehalf: isHrRole(viewer.role),
      balances: LEAVE_TYPES.map((type) => {
        const pol = policyByType[type];
        return {
          type,
          available: balances[type].balance,
          used: balances[type].used,
          pending: pending[type] ?? 0,
          accrues: pol?.accrues ?? false,
          accrualHoursPerMonth: pol ? Number(pol.accrualHoursPerMonth) : 0,
          maxBalanceHours: pol?.maxBalanceHours != null ? Number(pol.maxBalanceHours) : null,
        };
      }),
      requests: requests.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        startDate: r.startDate,
        endDate: r.endDate,
        hours: Number(r.hours),
        reason: r.reason,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      })),
    };
  });
}

// Whether this viewer is ever an approver (drives the "Approvals" nav + the page guard).
export function isApprover(viewer) {
  return isHrRole(viewer.role) || viewer.role === "MANAGER";
}

// The pending requests this viewer may act on. RLS scopes the rows to what they can SEE (a manager's
// subtree, HR everything); canApproveTimeOff then drops what they can't ACT on (their own request).
// Each item is annotated with the requester's available balance so the approver sees an overdraw.
export async function getPendingApprovals() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return [];

  return withViewer(viewer, async (tx) => {
    const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
    const pending = await tx.leaveRequest.findMany({
      where: { status: "PENDING" }, // RLS already limits this to visible subjects
      orderBy: [{ startDate: "asc" }],
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
    });
    const actionable = pending.filter((r) => canApproveTimeOff(viewer, r.employeeId, { subtreeIds }));

    // Available balance per requester (for the overdraw flag), in one ledger query.
    const empIds = [...new Set(actionable.map((r) => r.employeeId))];
    const ledger = empIds.length
      ? await tx.leaveLedgerEntry.findMany({ where: { employeeId: { in: empIds } }, select: { employeeId: true, type: true, hours: true } })
      : [];
    const ledgerByEmp = {};
    for (const l of ledger) (ledgerByEmp[l.employeeId] ??= []).push({ type: l.type, hours: Number(l.hours) });

    return actionable.map((r) => {
      const available = computeBalances(ledgerByEmp[r.employeeId] ?? [])[r.type].balance;
      const hours = Number(r.hours);
      return {
        id: r.id,
        type: r.type,
        startDate: r.startDate,
        endDate: r.endDate,
        hours,
        reason: r.reason,
        employee: r.employee,
        available,
        overdraw: r.type !== "UNPAID" && hours > available,
      };
    });
  });
}

// The org's accrual policies (HR only), for the /time-off/policies page. null for non-HR.
export async function getLeavePolicies() {
  const viewer = await getViewer();
  if (!viewer || !isHrRole(viewer.role)) return null;
  return withViewer(viewer, async (tx) => {
    const policies = await tx.leavePolicy.findMany({ where: { orgId: viewer.orgId }, orderBy: { type: "asc" } });
    return policies.map((p) => ({
      id: p.id,
      type: p.type,
      accrualHoursPerMonth: Number(p.accrualHoursPerMonth),
      maxBalanceHours: p.maxBalanceHours != null ? Number(p.maxBalanceHours) : null,
      accrues: p.accrues,
    }));
  });
}

// The employee picker for HR filing a request on someone's behalf. [] for non-HR viewers.
export async function getEmployeesForFiling() {
  const viewer = await getViewer();
  if (!viewer || !isHrRole(viewer.role)) return [];
  return withViewer(viewer, (tx) =>
    tx.employee.findMany({
      where: { employmentStatus: { not: "TERMINATED" } },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  );
}
