"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, isHrRole } from "@hris/auth";
import { shiftSchema, batchShiftSchema, shiftSwapSchema, decisionSchema, zonedWallClockToUtc, weekStart } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";
import { getT, getTimeZone } from "@/lib/i18n.server";

function errorMessage(e) {
  // Never surface internal DB errors (Prisma throws PrismaClient* errors) — only intentional messages.
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

// Only managers + HR build schedules. (The RLS shift_write policy is the DB-level backstop — a
// manager can only write their own department's shifts.)
function canManageSchedule(viewer) {
  return Boolean(viewer?.employeeId) && (isHrRole(viewer.role) || viewer.role === "MANAGER");
}

// The manager/HR viewer's own department id (schedules are built for your own department in M3).
async function requireDepartment(tx, viewer, t) {
  const me = await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } });
  if (!me?.departmentId) throw new Error(t("err.noDepartment"));
  return me.departmentId;
}

async function resolveShiftFields(tx, dept, input, tz, t) {
  // A named assignee must belong to this department (RLS-scoped lookup); absent = open shift.
  if (input.employeeId) {
    const assignee = await tx.employee.findFirst({ where: { id: input.employeeId, departmentId: dept }, select: { id: true } });
    if (!assignee) throw new Error(t("err.employeeNotInDept"));
  }
  return {
    employeeId: input.employeeId ?? null,
    // The typed HH:MM is wall-clock in the manager's timezone → store the true UTC instant.
    startAt: zonedWallClockToUtc(input.date, input.start, tz),
    endAt: zonedWallClockToUtc(input.date, input.end, tz),
    role: input.role ?? null,
    note: input.note ?? null,
  };
}

function parseShift(formData) {
  return shiftSchema.safeParse({
    employeeId: formData.get("employeeId") || undefined,
    date: formData.get("date"),
    start: formData.get("start"),
    end: formData.get("end"),
    role: formData.get("role") || undefined,
    note: formData.get("note") || undefined,
  });
}

// Create a DRAFT shift for the viewer's department (published later via publishWeek).
export async function createShift(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: t("err.notAuthorizedBuildSchedule") };
  const parsed = parseShift(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const input = parsed.data;
  const tz = await getTimeZone();

  try {
    await withViewer(viewer, async (tx) => {
      const dept = await requireDepartment(tx, viewer, t);
      const fields = await resolveShiftFields(tx, dept, input, tz, t);
      await tx.shift.create({ data: { departmentId: dept, published: false, createdById: viewer.userId, ...fields } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.shiftCreateFailed") };
  }
  const week = weekStart(input.date).toISOString().slice(0, 10);
  revalidatePath("/schedule");
  redirect(`/schedule?week=${week}`);
}

// Create MANY shifts at once (batch): every selected employee × selected day gets a shift with the same
// start/end/role/note, plus an open (unassigned) shift per day if requested. Same gating as createShift.
// Skips exact duplicates already on the schedule (same employee + start + end), so a re-submit or a
// double-click is idempotent. Times are the manager's wall-clock → stored as true UTC instants (tz).
export async function createShifts(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: t("err.notAuthorizedBuildSchedule") };
  const parsed = batchShiftSchema.safeParse({
    employeeIds: formData.getAll("employeeIds"),
    open: formData.get("open") === "on",
    days: formData.getAll("days"),
    start: formData.get("start"),
    end: formData.get("end"),
    role: formData.get("role") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const input = parsed.data;
  const tz = await getTimeZone();
  const firstDay = [...input.days].sort()[0];

  try {
    await withViewer(viewer, async (tx) => {
      const dept = await requireDepartment(tx, viewer, t);
      // Every named employee must belong to this department (RLS-scoped; open needs no check).
      if (input.employeeIds.length) {
        const found = await tx.employee.findMany({
          where: { id: { in: input.employeeIds }, departmentId: dept, employmentStatus: "ACTIVE" },
          select: { id: true },
        });
        if (found.length !== input.employeeIds.length) throw new Error(t("err.employeeNotInDept"));
      }
      const assignees = [...input.employeeIds, ...(input.open ? [null] : [])];

      // Skip exact duplicates already scheduled across the selected days. Range spans the selected
      // LOCAL days in the manager's timezone (so an evening shift on the last day isn't missed).
      const sorted = [...input.days].sort();
      const rangeStart = zonedWallClockToUtc(sorted[0], "00:00", tz);
      const rangeEnd = new Date(zonedWallClockToUtc(sorted[sorted.length - 1], "00:00", tz).getTime() + 86_400_000);
      const existing = await tx.shift.findMany({
        where: { departmentId: dept, startAt: { gte: rangeStart, lt: rangeEnd } },
        select: { employeeId: true, startAt: true, endAt: true },
      });
      const seen = new Set(existing.map((s) => `${s.employeeId ?? ""}|${s.startAt.toISOString()}|${s.endAt.toISOString()}`));

      const rows = [];
      for (const day of input.days) {
        const startAt = zonedWallClockToUtc(day, input.start, tz);
        const endAt = zonedWallClockToUtc(day, input.end, tz);
        for (const emp of assignees) {
          const key = `${emp ?? ""}|${startAt.toISOString()}|${endAt.toISOString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ departmentId: dept, employeeId: emp, startAt, endAt, role: input.role ?? null, note: input.note ?? null, published: false, createdById: viewer.userId });
        }
      }
      if (rows.length) await tx.shift.createMany({ data: rows });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.shiftCreateFailed") };
  }
  const week = weekStart(firstDay).toISOString().slice(0, 10);
  revalidatePath("/schedule");
  redirect(`/schedule?week=${week}`);
}

// Edit a shift (reassign / retime / relabel). Publication state is unchanged.
export async function updateShift(shiftId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: t("err.notAuthorizedEditSchedule") };
  const parsed = parseShift(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const input = parsed.data;
  const tz = await getTimeZone();

  try {
    await withViewer(viewer, async (tx) => {
      const existing = await tx.shift.findUnique({ where: { id: shiftId }, select: { departmentId: true } });
      if (!existing) throw new Error(t("err.shiftNotFound")); // RLS: not visible/manageable
      const fields = await resolveShiftFields(tx, existing.departmentId, input, tz, t);
      await tx.shift.update({ where: { id: shiftId }, data: fields });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.shiftUpdateFailed") };
  }
  const week = weekStart(input.date).toISOString().slice(0, 10);
  revalidatePath("/schedule");
  redirect(`/schedule?week=${week}`);
}

// Delete a shift (cascades its swap requests).
export async function deleteShift(shiftId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: t("err.notAuthorizedEditSchedule") };
  try {
    await withViewer(viewer, async (tx) => {
      // RLS shift_write USING gates the delete to a manageable row; deleteMany avoids a throw when hidden.
      const { count } = await tx.shift.deleteMany({ where: { id: shiftId } });
      if (count === 0) throw new Error(t("err.shiftNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.shiftDeleteFailed") };
  }
  revalidatePath("/schedule");
  redirect("/schedule");
}

// Publish every DRAFT shift in the viewer's department for a week → visible to the whole department.
export async function publishWeek(weekStartStr, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: t("err.notAuthorizedPublishSchedule") };
  const ws = weekStart(weekStartStr);
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 7);

  try {
    await withViewer(viewer, async (tx) => {
      const dept = await requireDepartment(tx, viewer, t);
      // RLS shift_write scopes updateMany to the manager's own department.
      await tx.shift.updateMany({
        where: { departmentId: dept, published: false, startAt: { gte: ws, lt: we } },
        data: { published: true },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.publishFailed") };
  }
  revalidatePath("/schedule");
  redirect(`/schedule?week=${ws.toISOString().slice(0, 10)}`);
}

// --- Swap / drop requests (employee-initiated → manager approves via the unified inbox) -----------

// An employee requests to drop (→ open) or swap one of THEIR OWN shifts. Audited; the manager decides.
export async function requestSwap(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: t("err.signedIn") };
  const parsed = shiftSwapSchema.safeParse({
    shiftId: formData.get("shiftId"),
    targetEmployeeId: formData.get("targetEmployeeId") || undefined,
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { employeeId: true } });
      if (!shift || shift.employeeId !== viewer.employeeId) throw new Error(t("err.swapOwnShiftOnly"));
      const existing = await tx.shiftSwapRequest.findFirst({ where: { shiftId: input.shiftId, status: "PENDING" } });
      if (existing) throw new Error(t("err.swapAlreadyPending"));

      const swap = await tx.shiftSwapRequest.create({
        data: {
          shiftId: input.shiftId,
          requestedByEmployeeId: viewer.employeeId,
          targetEmployeeId: input.targetEmployeeId ?? null,
          reason: input.reason ?? null,
          status: "PENDING",
        },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: viewer.employeeId,
          eventType: "SHIFT_SWAP_REQUEST",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: { swapId: swap.id, shiftId: input.shiftId, target: input.targetEmployeeId ?? "open", status: "PENDING" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.requestSubmitFailed") };
  }
  revalidatePath("/schedule");
  revalidatePath("/approvals");
  redirect("/schedule");
}

// Approve a swap → reassign the shift (to the target, or unassign to OPEN) + mark APPROVED + audit.
export async function approveSwap(swapId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.signedIn") };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const swap = await tx.shiftSwapRequest.findUnique({ where: { id: swapId }, include: { shift: { select: { id: true, departmentId: true } } } });
      if (!swap) throw new Error(t("err.requestNotFound"));
      if (swap.status !== "PENDING") throw new Error(t("err.onlyPendingReviewed"));
      if (!(await viewerCanApprove(viewer, swap.requestedByEmployeeId, tx))) {
        throw new Error(t("err.notAuthorizedReview"));
      }

      // Resolve the new assignee: a validated same-department target, or null (drop-to-open).
      let newEmployeeId = null;
      if (swap.targetEmployeeId) {
        const target = await tx.employee.findFirst({ where: { id: swap.targetEmployeeId, departmentId: swap.shift.departmentId }, select: { id: true } });
        if (!target) throw new Error(t("err.colleagueNotInDept"));
        newEmployeeId = target.id;
      }
      // Claim the swap atomically FIRST (PENDING→APPROVED) so only one concurrent approver proceeds to
      // reassign the shift — no double reassignment / double audit under a race.
      const { count } = await tx.shiftSwapRequest.updateMany({
        where: { id: swapId, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      if (count === 0) throw new Error(t("err.onlyPendingReviewed"));
      // RLS shift_write (app_can_manage_shift) admits the reassignment for the dept manager/HR.
      await tx.shift.update({ where: { id: swap.shiftId }, data: { employeeId: newEmployeeId } });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: swap.requestedByEmployeeId,
          eventType: "SHIFT_SWAP_APPROVE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { swapId, status: "PENDING" },
          afterState: { swapId, status: "APPROVED", reassignedTo: newEmployeeId ?? "open" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.requestApproveFailed") };
  }
  revalidatePath("/approvals");
  revalidatePath("/schedule");
  redirect("/approvals");
}

// Deny a swap → DENIED + audit. The shift is unchanged.
export async function denySwap(swapId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.signedIn") };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const swap = await tx.shiftSwapRequest.findUnique({ where: { id: swapId } });
      if (!swap) throw new Error(t("err.requestNotFound"));
      if (swap.status !== "PENDING") throw new Error(t("err.onlyPendingReviewed"));
      if (!(await viewerCanApprove(viewer, swap.requestedByEmployeeId, tx))) {
        throw new Error(t("err.notAuthorizedReview"));
      }
      // Atomic PENDING→DENIED so concurrent decisions can't both land.
      const { count } = await tx.shiftSwapRequest.updateMany({
        where: { id: swapId, status: "PENDING" },
        data: { status: "DENIED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      if (count === 0) throw new Error(t("err.onlyPendingReviewed"));
      await tx.employeeAuditLog.create({
        data: {
          employeeId: swap.requestedByEmployeeId,
          eventType: "SHIFT_SWAP_DENY",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { swapId, status: "PENDING" },
          afterState: { swapId, status: "DENIED" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.requestDenyFailed") };
  }
  revalidatePath("/approvals");
  revalidatePath("/schedule");
  redirect("/approvals");
}

// Dispatcher for the approvals inbox: one form, two buttons (name="intent" approve|deny).
export async function decideSwap(swapId, prevState, formData) {
  return formData.get("intent") === "deny"
    ? denySwap(swapId, prevState, formData)
    : approveSwap(swapId, prevState, formData);
}
