"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, isHrRole } from "@hris/auth";
import { shiftSchema, shiftSwapSchema, decisionSchema, toShiftInstant, weekStart } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";

function errorMessage(e) {
  return e instanceof Error ? e.message : undefined;
}

// Only managers + HR build schedules. (The RLS shift_write policy is the DB-level backstop — a
// manager can only write their own department's shifts.)
function canManageSchedule(viewer) {
  return Boolean(viewer?.employeeId) && (isHrRole(viewer.role) || viewer.role === "MANAGER");
}

// The manager/HR viewer's own department id (schedules are built for your own department in M3).
async function requireDepartment(tx, viewer) {
  const me = await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } });
  if (!me?.departmentId) throw new Error("Your account has no department.");
  return me.departmentId;
}

async function resolveShiftFields(tx, dept, input) {
  // A named assignee must belong to this department (RLS-scoped lookup); absent = open shift.
  if (input.employeeId) {
    const assignee = await tx.employee.findFirst({ where: { id: input.employeeId, departmentId: dept }, select: { id: true } });
    if (!assignee) throw new Error("That employee isn't in this department.");
  }
  return {
    employeeId: input.employeeId ?? null,
    startAt: toShiftInstant(input.date, input.start),
    endAt: toShiftInstant(input.date, input.end),
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
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: "You are not authorized to build the schedule." };
  const parsed = parseShift(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const dept = await requireDepartment(tx, viewer);
      const fields = await resolveShiftFields(tx, dept, input);
      await tx.shift.create({ data: { departmentId: dept, published: false, createdById: viewer.userId, ...fields } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not create the shift." };
  }
  const week = weekStart(input.date).toISOString().slice(0, 10);
  revalidatePath("/schedule");
  redirect(`/schedule?week=${week}`);
}

// Edit a shift (reassign / retime / relabel). Publication state is unchanged.
export async function updateShift(shiftId, _prevState, formData) {
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: "You are not authorized to edit the schedule." };
  const parsed = parseShift(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const existing = await tx.shift.findUnique({ where: { id: shiftId }, select: { departmentId: true } });
      if (!existing) throw new Error("Shift not found."); // RLS: not visible/manageable
      const fields = await resolveShiftFields(tx, existing.departmentId, input);
      await tx.shift.update({ where: { id: shiftId }, data: fields });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not update the shift." };
  }
  const week = weekStart(input.date).toISOString().slice(0, 10);
  revalidatePath("/schedule");
  redirect(`/schedule?week=${week}`);
}

// Delete a shift (cascades its swap requests).
export async function deleteShift(shiftId, _prevState) {
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: "You are not authorized to edit the schedule." };
  try {
    await withViewer(viewer, async (tx) => {
      // RLS shift_write USING gates the delete to a manageable row; deleteMany avoids a throw when hidden.
      const { count } = await tx.shift.deleteMany({ where: { id: shiftId } });
      if (count === 0) throw new Error("Shift not found.");
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not delete the shift." };
  }
  revalidatePath("/schedule");
  redirect("/schedule");
}

// Publish every DRAFT shift in the viewer's department for a week → visible to the whole department.
export async function publishWeek(weekStartStr, _prevState) {
  const viewer = await getViewer();
  if (!canManageSchedule(viewer)) return { error: "You are not authorized to publish the schedule." };
  const ws = weekStart(weekStartStr);
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 7);

  try {
    await withViewer(viewer, async (tx) => {
      const dept = await requireDepartment(tx, viewer);
      // RLS shift_write scopes updateMany to the manager's own department.
      await tx.shift.updateMany({
        where: { departmentId: dept, published: false, startAt: { gte: ws, lt: we } },
        data: { published: true },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not publish the schedule." };
  }
  revalidatePath("/schedule");
  redirect(`/schedule?week=${ws.toISOString().slice(0, 10)}`);
}

// --- Swap / drop requests (employee-initiated → manager approves via the unified inbox) -----------

// An employee requests to drop (→ open) or swap one of THEIR OWN shifts. Audited; the manager decides.
export async function requestSwap(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "You must be signed in." };
  const parsed = shiftSwapSchema.safeParse({
    shiftId: formData.get("shiftId"),
    targetEmployeeId: formData.get("targetEmployeeId") || undefined,
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { employeeId: true } });
      if (!shift || shift.employeeId !== viewer.employeeId) throw new Error("You can only request a swap for your own shift.");
      const existing = await tx.shiftSwapRequest.findFirst({ where: { shiftId: input.shiftId, status: "PENDING" } });
      if (existing) throw new Error("There's already a pending request for this shift.");

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
    return { error: errorMessage(e) ?? "Could not submit the request." };
  }
  revalidatePath("/schedule");
  revalidatePath("/approvals");
  redirect("/schedule");
}

// Approve a swap → reassign the shift (to the target, or unassign to OPEN) + mark APPROVED + audit.
export async function approveSwap(swapId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      const swap = await tx.shiftSwapRequest.findUnique({ where: { id: swapId }, include: { shift: { select: { id: true, departmentId: true } } } });
      if (!swap) throw new Error("Request not found.");
      if (swap.status !== "PENDING") throw new Error("Only a pending request can be reviewed.");
      if (!(await viewerCanApprove(viewer, swap.requestedByEmployeeId, tx))) {
        throw new Error("You are not authorized to review this request.");
      }

      // Resolve the new assignee: a validated same-department target, or null (drop-to-open).
      let newEmployeeId = null;
      if (swap.targetEmployeeId) {
        const target = await tx.employee.findFirst({ where: { id: swap.targetEmployeeId, departmentId: swap.shift.departmentId }, select: { id: true } });
        if (!target) throw new Error("The requested colleague isn't in this department.");
        newEmployeeId = target.id;
      }
      // RLS shift_write (app_can_manage_shift) admits the reassignment for the dept manager/HR.
      await tx.shift.update({ where: { id: swap.shiftId }, data: { employeeId: newEmployeeId } });
      await tx.shiftSwapRequest.update({
        where: { id: swapId },
        data: { status: "APPROVED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
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
    return { error: errorMessage(e) ?? "Could not approve the request." };
  }
  revalidatePath("/approvals");
  revalidatePath("/schedule");
  redirect("/approvals");
}

// Deny a swap → DENIED + audit. The shift is unchanged.
export async function denySwap(swapId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      const swap = await tx.shiftSwapRequest.findUnique({ where: { id: swapId } });
      if (!swap) throw new Error("Request not found.");
      if (swap.status !== "PENDING") throw new Error("Only a pending request can be reviewed.");
      if (!(await viewerCanApprove(viewer, swap.requestedByEmployeeId, tx))) {
        throw new Error("You are not authorized to review this request.");
      }
      await tx.shiftSwapRequest.update({
        where: { id: swapId },
        data: { status: "DENIED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
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
    return { error: errorMessage(e) ?? "Could not deny the request." };
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
