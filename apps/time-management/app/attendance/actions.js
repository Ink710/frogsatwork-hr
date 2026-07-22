"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { pairPunches, clockCorrectionSchema, toShiftInstant } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";

function errorMessage(e) {
  return e instanceof Error ? e.message : undefined;
}

// Today's UTC-day bounds for the viewer's own open-punch check.
function todayBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// Whether the viewer currently has an open punch today (an IN with no matching OUT).
async function isClockedIn(tx, employeeId) {
  const { start, end } = todayBounds();
  const events = await tx.clockEvent.findMany({
    where: { employeeId, at: { gte: start, lt: end } },
    orderBy: { at: "asc" },
    select: { type: true, at: true },
  });
  return pairPunches(events).open;
}

// Clock IN — self only. Refuses a double clock-in (you must clock out first). The punch row is the
// viewer's own (employeeId = self), so RLS WITH CHECK admits it and plain create() works.
export async function clockIn() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "You must be signed in." };
  try {
    await withViewer(viewer, async (tx) => {
      if (await isClockedIn(tx, viewer.employeeId)) throw new Error("You're already clocked in.");
      const at = new Date();
      await tx.clockEvent.create({
        data: { employeeId: viewer.employeeId, createdById: viewer.userId, type: "IN", source: "WEB", at },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: viewer.employeeId,
          eventType: "CLOCK_IN",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: { at: at.toISOString(), source: "WEB" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not clock in." };
  }
  revalidatePath("/attendance");
  return { ok: true };
}

// Clock OUT — self only. Refuses if there's no open punch to close.
export async function clockOut() {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "You must be signed in." };
  try {
    await withViewer(viewer, async (tx) => {
      if (!(await isClockedIn(tx, viewer.employeeId))) throw new Error("You're not clocked in.");
      const at = new Date();
      await tx.clockEvent.create({
        data: { employeeId: viewer.employeeId, createdById: viewer.userId, type: "OUT", source: "WEB", at },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: viewer.employeeId,
          eventType: "CLOCK_OUT",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: { at: at.toISOString(), source: "WEB" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not clock out." };
  }
  revalidatePath("/attendance");
  return { ok: true };
}

// Correct an employee's attendance — HR/manager only, gated by viewerCanApprove (the same
// HR-or-manager-of-subtree rule as the approvals inbox; you can never correct your own punches).
// Corrections are APPEND-ONLY: we add a MANUAL punch (e.g. an OUT to close a forgotten clock-out),
// never mutate an existing row, so the ledger stays a faithful history. RLS WITH CHECK admits the
// insert because the subject is already within the corrector's visibility scope.
export async function correctClock(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "You must be signed in." };
  const parsed = clockCorrectionSchema.safeParse({
    employeeId: formData.get("employeeId"),
    type: formData.get("type"),
    date: formData.get("date"),
    time: formData.get("time"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      if (!(await viewerCanApprove(viewer, input.employeeId, tx))) {
        throw new Error("You are not authorized to correct this employee’s attendance.");
      }
      const at = toShiftInstant(input.date, input.time);
      await tx.clockEvent.create({
        data: {
          employeeId: input.employeeId,
          createdById: viewer.userId,
          type: input.type,
          source: "MANUAL",
          at,
          note: input.note ?? null,
        },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: input.employeeId,
          eventType: "CLOCK_CORRECTION",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: { at: at.toISOString(), type: input.type, source: "MANUAL", note: input.note ?? null },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not save the correction." };
  }
  revalidatePath("/attendance/team");
  redirect(`/attendance/team?date=${input.date}`);
}
