import "server-only";
import { getViewer, withViewer, isHrRole, getSubtreeIds } from "@hris/auth";
import { computeBalances, pendingHours, canApproveForEmployee, computeTimesheet, weekStart, shiftTimeLabel, hoursBetween, computeAttendanceDay, LEAVE_TYPES } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";

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
      projectId: e.projectId,
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

// --- Scheduling -----------------------------------------------------------------------------------

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

// The viewer's DEPARTMENT schedule for one week (default: the current week). RLS scopes the rows:
// an employee sees the published dept schedule + their own; a manager sees all (incl. drafts) in
// their dept; HR sees all in the dept. Returns null when the account has no employee/department.
export async function getWeekSchedule(weekStartStr = null) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  const ws = weekStart(weekStartStr ?? new Date());
  const weStart = addDays(ws, 7); // exclusive upper bound

  return withViewer(viewer, async (tx) => {
    const me = await tx.employee.findUnique({
      where: { id: viewer.employeeId },
      select: { departmentId: true, department: { select: { id: true, name: true } } },
    });
    if (!me?.departmentId) return null;

    const shifts = await tx.shift.findMany({
      where: { departmentId: me.departmentId, startAt: { gte: ws, lt: weStart } },
      orderBy: { startAt: "asc" },
    });

    // The posted schedule shows WHO is on — but Employee RLS hides peers from an employee, so a
    // plain `include: employee` would blank out colleagues' names. Resolve names through the org-chart
    // SECURITY DEFINER function (structural columns only — same primitive the org chart uses).
    const roster = await tx.$queryRaw`SELECT id, "firstName", "lastName" FROM app_org_chart(${viewer.orgId})`;
    const nameById = Object.fromEntries(roster.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

    const byDay = {};
    for (let i = 0; i < 7; i++) byDay[dayKey(addDays(ws, i))] = [];
    for (const s of shifts) {
      const key = dayKey(s.startAt);
      (byDay[key] ??= []).push({
        id: s.id,
        isMine: s.employeeId === viewer.employeeId,
        employeeName: s.employeeId ? (nameById[s.employeeId] ?? null) : null, // null = open shift
        startTime: shiftTimeLabel(s.startAt),
        endTime: shiftTimeLabel(s.endAt),
        hours: hoursBetween(s.startAt, s.endAt),
        role: s.role,
        note: s.note,
        published: s.published,
      });
    }

    const canManage = isHrRole(viewer.role) || viewer.role === "MANAGER";
    return {
      department: me.department,
      weekStart: dayKey(ws),
      weekEnd: dayKey(addDays(ws, 6)),
      prevWeek: dayKey(addDays(ws, -7)),
      nextWeek: dayKey(addDays(ws, 7)),
      canManage,
      hasDrafts: shifts.some((s) => !s.published),
      days: Array.from({ length: 7 }, (_, i) => {
        const date = dayKey(addDays(ws, i));
        return { date, shifts: byDay[date] ?? [] };
      }),
    };
  });
}

// Data for the shift create/edit form (managers/HR only): the department's assignable employees.
export async function getShiftFormData() {
  const viewer = await getViewer();
  if (!viewer?.employeeId || !(isHrRole(viewer.role) || viewer.role === "MANAGER")) return null;
  return withViewer(viewer, async (tx) => {
    const me = await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true, department: { select: { id: true, name: true } } } });
    if (!me?.departmentId) return null;
    const employees = await tx.employee.findMany({
      where: { departmentId: me.departmentId, employmentStatus: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return { department: me.department, employees };
  });
}

// The existing shift + the form data, for the edit page. null if not visible/manageable.
export async function getShiftForEdit(shiftId) {
  const form = await getShiftFormData();
  if (!form) return null;
  const viewer = await getViewer();
  return withViewer(viewer, async (tx) => {
    const s = await tx.shift.findUnique({ where: { id: shiftId } }); // RLS-scoped
    if (!s) return null;
    return {
      ...form,
      shift: {
        id: s.id,
        employeeId: s.employeeId,
        date: dayKey(s.startAt),
        start: shiftTimeLabel(s.startAt),
        end: shiftTimeLabel(s.endAt),
        role: s.role,
        note: s.note,
        published: s.published,
      },
    };
  });
}

// The swap form for one of the viewer's OWN shifts: shift details + the department colleagues they
// could swap with. Colleague names come from app_org_chart (Employee RLS hides peers). null if the
// shift isn't the viewer's own.
export async function getSwapForm(shiftId) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  return withViewer(viewer, async (tx) => {
    const shift = await tx.shift.findUnique({
      where: { id: shiftId },
      select: { id: true, employeeId: true, startAt: true, endAt: true, department: { select: { name: true } } },
    });
    if (!shift || shift.employeeId !== viewer.employeeId) return null;

    const roster = await tx.$queryRaw`SELECT id, "firstName", "lastName", department FROM app_org_chart(${viewer.orgId})`;
    const targets = roster
      .filter((r) => r.department === shift.department?.name && r.id !== viewer.employeeId)
      .map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }));

    return {
      shift: { id: shift.id, date: dayKey(shift.startAt), start: shiftTimeLabel(shift.startAt), end: shiftTimeLabel(shift.endAt) },
      targets,
    };
  });
}

// PENDING swap requests this viewer may act on (unified approvals inbox). Same scoping as the other
// queues; the approver can see requester + target Employee rows (subtree/all), so include works here.
export async function getPendingSwaps() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return [];
  return withViewer(viewer, async (tx) => {
    const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
    const swaps = await tx.shiftSwapRequest.findMany({
      where: { status: "PENDING" }, // RLS limits to visible requesters
      orderBy: { createdAt: "asc" },
      include: {
        shift: { select: { startAt: true, endAt: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        target: { select: { firstName: true, lastName: true } },
      },
    });
    return swaps
      .filter((s) => canApproveForEmployee(viewer, s.requestedByEmployeeId, { subtreeIds }))
      .map((s) => ({
        id: s.id,
        requester: s.requestedBy,
        targetName: s.target ? `${s.target.firstName} ${s.target.lastName}` : null, // null = drop-to-open
        reason: s.reason,
        shiftDate: s.shift.startAt,
        startTime: shiftTimeLabel(s.shift.startAt),
        endTime: shiftTimeLabel(s.shift.endAt),
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

// ─── Attendance / clock (M4) ────────────────────────────────────────────────────────────────────
// The ClockEvent ledger is the only stored fact; worked hours + schedule variance are derived here
// at read time via computeAttendanceDay (pure rule). Nothing to keep in sync.

const startOfUtcDay = (d) => {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
};

// Turn a computed day + its (optional) shift into a plain, client-safe shape (labels, not Dates).
function serializeAttendanceDay(date, day, shift) {
  return {
    date,
    status: day.status,
    workedHours: day.workedHours,
    open: day.open,
    firstIn: day.firstIn ? shiftTimeLabel(day.firstIn) : null,
    lastOut: day.lastOut ? shiftTimeLabel(day.lastOut) : null,
    lateMinutes: day.lateMinutes,
    shortHours: day.shortHours,
    scheduled: shift ? { start: shiftTimeLabel(shift.startAt), end: shiftTimeLabel(shift.endAt) } : null,
  };
}

// The viewer's CURRENT clock state (drives the Clock in/out button + today's card). Reads only
// today's punches + today's own published shift, pairs them, and reports whether a session is open.
export async function getClockStatus() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  const today = startOfUtcDay(new Date());
  const tomorrow = addDays(today, 1);

  return withViewer(viewer, async (tx) => {
    const events = await tx.clockEvent.findMany({
      where: { employeeId: viewer.employeeId, at: { gte: today, lt: tomorrow } },
      orderBy: { at: "asc" },
      select: { type: true, at: true },
    });
    const shift = await tx.shift.findFirst({
      where: { employeeId: viewer.employeeId, published: true, startAt: { gte: today, lt: tomorrow } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true },
    });
    const day = computeAttendanceDay(events, shift);
    const openSession = day.open ? day.sessions[day.sessions.length - 1] : null;
    return {
      date: dayKey(today),
      clockedIn: day.open,
      since: openSession ? shiftTimeLabel(openSession.inAt) : null,
      ...serializeAttendanceDay(dayKey(today), day, shift),
    };
  });
}

// The viewer's own recent attendance (last 14 days) — one row per day that has punches or a shift,
// newest first, each with its derived status vs the scheduled shift.
export async function getMyAttendance() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  const today = startOfUtcDay(new Date());
  const rangeStart = addDays(today, -13);
  const rangeEnd = addDays(today, 1); // exclusive

  return withViewer(viewer, async (tx) => {
    const events = await tx.clockEvent.findMany({
      where: { employeeId: viewer.employeeId, at: { gte: rangeStart, lt: rangeEnd } },
      orderBy: { at: "asc" },
      select: { type: true, at: true },
    });
    const shifts = await tx.shift.findMany({
      where: { employeeId: viewer.employeeId, published: true, startAt: { gte: rangeStart, lt: rangeEnd } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true },
    });

    const eventsByDay = {};
    for (const e of events) (eventsByDay[dayKey(e.at)] ??= []).push(e);
    const shiftByDay = {};
    for (const s of shifts) shiftByDay[dayKey(s.startAt)] = s;

    const days = [];
    for (let i = 0; i < 14; i++) {
      const date = dayKey(addDays(today, -i));
      const dayEvents = eventsByDay[date] ?? [];
      const shift = shiftByDay[date] ?? null;
      if (dayEvents.length === 0 && !shift) continue; // nothing to report this day
      days.push(serializeAttendanceDay(date, computeAttendanceDay(dayEvents, shift), shift));
    }
    return { days };
  });
}

// The team's attendance for ONE day (managers/HR). RLS scopes ClockEvent + Shift rows to what the
// viewer may see (a manager's subtree / dept, HR everything); canApproveForEmployee then drops any
// subject they can't act on (notably themselves). One row per subject who punched or was scheduled,
// each with its derived variance. Names come from app_org_chart (Employee RLS hides peers). null for
// non-approvers → the page 404s.
export async function getTeamAttendance(dateStr = null) {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return null;
  const day = startOfUtcDay(dateStr ? new Date(dateStr) : new Date());
  const next = addDays(day, 1);

  return withViewer(viewer, async (tx) => {
    const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
    const events = await tx.clockEvent.findMany({
      where: { at: { gte: day, lt: next } },
      orderBy: { at: "asc" },
      select: { employeeId: true, type: true, at: true },
    });
    // Only ASSIGNED published shifts map to a person's attendance (open shifts are nobody's punch).
    const shifts = await tx.shift.findMany({
      where: { published: true, employeeId: { not: null }, startAt: { gte: day, lt: next } },
      select: { employeeId: true, startAt: true, endAt: true },
    });

    const eventsByEmp = {};
    for (const e of events) (eventsByEmp[e.employeeId] ??= []).push(e);
    const shiftByEmp = {};
    for (const s of shifts) shiftByEmp[s.employeeId] = s;

    const subjectIds = [...new Set([...Object.keys(eventsByEmp), ...Object.keys(shiftByEmp)])].filter((id) =>
      canApproveForEmployee(viewer, id, { subtreeIds }),
    );

    const roster = await tx.$queryRaw`SELECT id, "firstName", "lastName" FROM app_org_chart(${viewer.orgId})`;
    const nameById = Object.fromEntries(roster.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

    const rows = subjectIds
      .map((id) => {
        const shift = shiftByEmp[id] ?? null;
        const computed = computeAttendanceDay(eventsByEmp[id] ?? [], shift);
        return { employeeId: id, name: nameById[id] ?? "—", ...serializeAttendanceDay(dayKey(day), computed, shift) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      date: dayKey(day),
      prevDay: dayKey(addDays(day, -1)),
      nextDay: dayKey(addDays(day, 1)),
      rows,
    };
  });
}

// The subject of a clock correction (name + id), for the correction form. Gated to an approver who
// may act on that subject; null otherwise → the page 404s. Name via app_org_chart (structural only).
export async function getCorrectionTarget(employeeId) {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer) || !employeeId) return null;
  return withViewer(viewer, async (tx) => {
    if (!(await viewerCanApprove(viewer, employeeId, tx))) return null;
    const roster = await tx.$queryRaw`SELECT id, "firstName", "lastName" FROM app_org_chart(${viewer.orgId})`;
    const row = roster.find((r) => r.id === employeeId);
    return row ? { id: row.id, name: `${row.firstName} ${row.lastName}` } : null;
  });
}

// ─── Dashboard (M5) ─────────────────────────────────────────────────────────────────────────────
// The "My time" home is a role-aware dashboard. It's a COMPOSITION layer: every number already
// exists as an M1–M4 query, so these functions mostly fan out to those (independent fns → their own
// withViewer tx → Promise.all is genuinely parallel, no shared-tx pg warning) and roll the results
// into compact tiles.

// The viewer's next published shift assigned to them (from now forward). null if none.
export async function getMyNextShift() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  return withViewer(viewer, async (tx) => {
    const s = await tx.shift.findFirst({
      where: { employeeId: viewer.employeeId, published: true, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true, role: true },
    });
    return s ? { date: dayKey(s.startAt), start: shiftTimeLabel(s.startAt), end: shiftTimeLabel(s.endAt), role: s.role } : null;
  });
}

// Approved leave overlapping a day (default today), RLS-scoped (manager subtree / HR all / employee
// self). Names resolve via `include: employee` because an approver can see the subject's Employee row
// (unlike peers in the attendance team view — no app_org_chart needed here). Parameterized on date so
// the integration test is deterministic against seeded leave.
export async function getWhosOffToday(dateStr = null) {
  const viewer = await getViewer();
  if (!viewer) return [];
  const day = startOfUtcDay(dateStr ? new Date(dateStr) : new Date());
  const next = addDays(day, 1);
  return withViewer(viewer, async (tx) => {
    const reqs = await tx.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt: next }, endDate: { gte: day } },
      orderBy: { startDate: "asc" },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    return reqs.map((r) => ({
      employeeId: r.employeeId,
      name: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : "—",
      type: r.type,
      endDate: dayKey(r.endDate),
    }));
  });
}

// The personal "my time at a glance" snapshot shown to EVERY role. Composes the self queries into a
// compact shape. null when the account has no employee record.
export async function getMyTimeSnapshot() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  const [clock, timesheet, timeOff, nextShift] = await Promise.all([
    getClockStatus(),
    getCurrentTimesheet(),
    getTimeOffOverview(),
    getMyNextShift(),
  ]);
  const pendingRequests = timeOff ? timeOff.requests.filter((r) => r.status === "PENDING").length : 0;
  // Total available PTO across the paid types (UNPAID is tracked but never a balance).
  const ptoAvailable = timeOff
    ? Math.round(timeOff.balances.filter((b) => b.type !== "UNPAID").reduce((s, b) => s + b.available, 0) * 100) / 100
    : 0;
  return {
    clock,
    timesheet: timesheet
      ? { weekStart: timesheet.weekStart, weekEnd: timesheet.weekEnd, status: timesheet.status, total: timesheet.hours.total, overtime: timesheet.hours.overtime }
      : null,
    ptoAvailable,
    pendingRequests,
    nextShift,
  };
}

// ─── Projects (M8) ──────────────────────────────────────────────────────────────────────────────
// Assignment-based: a manager/HR creates projects and assigns employees; an employee's picker only
// shows projects they're assigned to (the assignment join is RLS'd, so scoping is free). Project rows
// themselves are org-scoped config with no RLS; management is gated here in the app layer.

// Managers + HR manage projects (mirrors canManageSchedule).
export function canManageProjects(viewer) {
  return Boolean(viewer?.employeeId) && (isHrRole(viewer.role) || viewer.role === "MANAGER");
}

// The viewer's ACTIVE assigned projects — feeds the timesheet picker. RLS scopes the assignment join.
export async function getMyProjects() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return [];
  return withViewer(viewer, async (tx) => {
    const rows = await tx.projectAssignment.findMany({
      where: { employeeId: viewer.employeeId, project: { status: "ACTIVE" } },
      select: { project: { select: { id: true, name: true, code: true } } },
      orderBy: { project: { name: "asc" } },
    });
    return rows.map((r) => r.project);
  });
}

// Projects the viewer manages (their own; HR sees all in the org) + assignee counts. For /projects.
// null for non-managers → the page 404s. The assignee _count is RLS-scoped to visible assignments,
// which for a manager's own project is exactly its (subtree) assignees.
export async function getManagedProjects() {
  const viewer = await getViewer();
  if (!viewer || !canManageProjects(viewer)) return null;
  return withViewer(viewer, async (tx) => {
    const where = isHrRole(viewer.role)
      ? { orgId: viewer.orgId }
      : { orgId: viewer.orgId, createdById: viewer.userId };
    const projects = await tx.project.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { _count: { select: { assignments: true } } },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      assigneeCount: p._count.assignments,
    }));
  });
}

// One project's detail + its assignees + the employees the viewer may still assign (RLS-scoped active
// employees, manager→subtree / HR→all, minus those already assigned). null if not manageable → 404.
export async function getProjectForManage(projectId) {
  const viewer = await getViewer();
  if (!viewer || !canManageProjects(viewer) || !projectId) return null;
  return withViewer(viewer, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, code: true, status: true, createdById: true, orgId: true },
    });
    if (!project || project.orgId !== viewer.orgId) return null;
    if (!isHrRole(viewer.role) && project.createdById !== viewer.userId) return null; // manager: own only

    const assignments = await tx.projectAssignment.findMany({
      where: { projectId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
      orderBy: { createdAt: "asc" },
    });
    const assignedIds = assignments.map((a) => a.employeeId);
    const candidates = await tx.employee.findMany({
      where: { employmentStatus: "ACTIVE", id: { notIn: assignedIds } },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return {
      project: { id: project.id, name: project.name, code: project.code, status: project.status },
      assignees: assignments.map((a) => ({
        assignmentId: a.id,
        employeeId: a.employeeId,
        name: `${a.employee.firstName} ${a.employee.lastName}`,
        employeeNumber: a.employee.employeeNumber,
      })),
      candidates: candidates.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        employeeNumber: e.employeeNumber,
      })),
    };
  });
}

// The manager/HR oversight roll-up. null for non-approvers → the page hides the whole section.
export async function getTeamTimeSnapshot() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) return null;
  const [leave, timesheets, swaps, whosOff, team] = await Promise.all([
    getPendingLeave(),
    getPendingTimesheets(),
    getPendingSwaps(),
    getWhosOffToday(),
    getTeamAttendance(), // today
  ]);
  const otFlags = timesheets.filter((t) => t.overtime > 0).length;
  const todayExceptions = { late: 0, absent: 0, short: 0, open: 0 };
  for (const r of team?.rows ?? []) {
    if (r.status === "LATE") todayExceptions.late += 1;
    else if (r.status === "ABSENT") todayExceptions.absent += 1;
    else if (r.status === "SHORT") todayExceptions.short += 1;
    else if (r.status === "OPEN") todayExceptions.open += 1;
  }
  return {
    pendingApprovals: {
      leave: leave.length,
      timesheets: timesheets.length,
      swaps: swaps.length,
      total: leave.length + timesheets.length + swaps.length,
    },
    whosOffToday: whosOff,
    todayExceptions,
    otFlags,
  };
}
