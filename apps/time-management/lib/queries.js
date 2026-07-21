import "server-only";
import { getViewer, withViewer, isHrRole, getSubtreeIds } from "@hris/auth";
import { computeBalances, pendingHours, canApproveForEmployee, computeTimesheet, weekStart, LEAVE_TYPES } from "@hris/workable-hours";

// The employee's CURRENT FLSA classification (drives timesheet overtime eligibility), read from the
// open EmployeeHistory row — the same "current version" lookup employee-records uses for edits.
async function currentFlsa(tx, employeeId) {
  const h = await tx.employeeHistory.findFirst({
    where: { employeeId, effectiveTo: null },
    orderBy: { version: "desc" },
    select: { flsaClassification: true },
  });
  return h?.flsaClassification ?? null;
}

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

// The pending LEAVE requests this viewer may act on. RLS scopes the rows to what they can SEE (a
// manager's subtree, HR everything); canApproveForEmployee then drops what they can't ACT on (their
// own). Each item is annotated with the requester's available balance so the approver sees an overdraw.
export async function getPendingLeave() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return [];

  return withViewer(viewer, async (tx) => {
    const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
    const pending = await tx.leaveRequest.findMany({
      where: { status: "PENDING" }, // RLS already limits this to visible subjects
      orderBy: [{ startDate: "asc" }],
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
    });
    const actionable = pending.filter((r) => canApproveForEmployee(viewer, r.employeeId, { subtreeIds }));

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

// The SUBMITTED timesheets this viewer may act on (for the unified approvals inbox). Same scoping as
// getPendingLeave; each is annotated with its derived total + overtime (using the subject's FLSA).
export async function getPendingTimesheets() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return [];

  return withViewer(viewer, async (tx) => {
    const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
    const sheets = await tx.timesheet.findMany({
      where: { status: "SUBMITTED" }, // RLS already limits to visible subjects
      orderBy: { periodStart: "asc" },
      include: {
        entries: { select: { workDate: true, hours: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
    const actionable = sheets.filter((s) => canApproveForEmployee(viewer, s.employeeId, { subtreeIds }));

    // Batch the FLSA classification for the distinct subjects (drives overtime eligibility).
    const empIds = [...new Set(actionable.map((s) => s.employeeId))];
    const histories = empIds.length
      ? await tx.employeeHistory.findMany({ where: { employeeId: { in: empIds }, effectiveTo: null }, select: { employeeId: true, flsaClassification: true } })
      : [];
    const flsaByEmp = Object.fromEntries(histories.map((h) => [h.employeeId, h.flsaClassification]));

    return actionable.map((s) => {
      const hours = computeTimesheet(s.entries.map((e) => ({ workDate: e.workDate, hours: Number(e.hours) })), flsaByEmp[s.employeeId]);
      return {
        id: s.id,
        employee: s.employee,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        total: hours.total,
        overtime: hours.overtime,
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

// The viewer's timesheet for one week (default: the current week) + its entries + derived hours.
// Returns null only when the account has no employee record.
export async function getCurrentTimesheet(weekStartStr = null) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  const subjectId = viewer.employeeId;
  const ws = weekStart(weekStartStr ?? new Date());
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 6);

  return withViewer(viewer, async (tx) => {
    const flsa = await currentFlsa(tx, subjectId);
    const timesheet = await tx.timesheet.findUnique({
      where: { employeeId_periodStart: { employeeId: subjectId, periodStart: ws } },
      include: { entries: { orderBy: { workDate: "asc" } } },
    });
    const entries = (timesheet?.entries ?? []).map((e) => ({
      workDate: e.workDate.toISOString().slice(0, 10),
      hours: Number(e.hours),
      project: e.project,
      note: e.note,
    }));
    const status = timesheet?.status ?? "DRAFT";
    return {
      id: timesheet?.id ?? null,
      weekStart: ws.toISOString().slice(0, 10),
      weekEnd: we.toISOString().slice(0, 10),
      status,
      editable: status === "DRAFT" || status === "REJECTED",
      flsa,
      decisionNote: timesheet?.decisionNote ?? null,
      entries,
      hours: computeTimesheet(entries, flsa),
    };
  });
}

// The viewer's recent timesheets (history list), each with derived total + overtime.
export async function getMyTimesheets() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return [];
  const subjectId = viewer.employeeId;
  return withViewer(viewer, async (tx) => {
    const flsa = await currentFlsa(tx, subjectId);
    const sheets = await tx.timesheet.findMany({
      where: { employeeId: subjectId },
      orderBy: { periodStart: "desc" },
      include: { entries: { select: { workDate: true, hours: true } } },
      take: 12,
    });
    return sheets.map((ts) => {
      const hours = computeTimesheet(ts.entries.map((e) => ({ workDate: e.workDate, hours: Number(e.hours) })), flsa);
      return { id: ts.id, periodStart: ts.periodStart, periodEnd: ts.periodEnd, status: ts.status, total: hours.total, overtime: hours.overtime };
    });
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
