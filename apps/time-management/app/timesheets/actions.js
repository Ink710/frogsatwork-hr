"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { timesheetEntriesSchema, decisionSchema, weekStart } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";

function errorMessage(e) {
  return e instanceof Error ? e.message : undefined;
}

// Persist one week's grid: ensure a DRAFT timesheet exists (a REJECTED one reopens to DRAFT), then
// replace its day rows with the non-zero entries. Returns the timesheet id. Runs inside a withViewer
// tx so RLS admits the writes (an employee editing their own). Throws on a locked/invalid week.
async function saveEntries(tx, subjectId, weekStartStr, formData) {
  let raw;
  try {
    raw = JSON.parse(formData.get("entries") || "[]");
  } catch {
    throw new Error("Could not read the timesheet.");
  }
  const parsed = timesheetEntriesSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid entries.");

  const ws = weekStart(weekStartStr);
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 6);

  const existing = await tx.timesheet.findUnique({
    where: { employeeId_periodStart: { employeeId: subjectId, periodStart: ws } },
  });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
    throw new Error("This week is already submitted and can't be edited.");
  }

  let timesheet = existing;
  if (!timesheet) {
    // create()'s RETURNING re-applies the SELECT policy; fine here — the employee sees themselves.
    timesheet = await tx.timesheet.create({ data: { employeeId: subjectId, periodStart: ws, periodEnd: we, status: "DRAFT" } });
  } else if (timesheet.status === "REJECTED") {
    // A rejected sheet reopens for editing.
    timesheet = await tx.timesheet.update({
      where: { id: timesheet.id },
      data: { status: "DRAFT", decisionNote: null, reviewedById: null, reviewedAt: null },
    });
  }

  // Replace-all: drop the old rows, insert the current non-zero days.
  await tx.timeEntry.deleteMany({ where: { timesheetId: timesheet.id } });
  const rows = parsed.data
    .filter((e) => e.hours > 0)
    .map((e) => ({
      timesheetId: timesheet.id,
      employeeId: subjectId,
      workDate: new Date(`${e.workDate}T00:00:00.000Z`),
      hours: e.hours.toFixed(2),
      project: e.project ?? null,
      note: e.note ?? null,
    }));
  if (rows.length) await tx.timeEntry.createMany({ data: rows });
  return timesheet.id;
}

// Save the current grid as a DRAFT (no status change, no audit).
export async function saveTimesheetDraft(weekStartStr, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "Your account has no employee record." };
  try {
    await withViewer(viewer, (tx) => saveEntries(tx, viewer.employeeId, weekStartStr, formData));
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not save the timesheet." };
  }
  revalidatePath("/timesheets");
  redirect("/timesheets");
}

// Save the grid AND submit it for approval (DRAFT/REJECTED → SUBMITTED + audit). You submit your own.
export async function submitTimesheet(weekStartStr, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: "Your account has no employee record." };
  try {
    await withViewer(viewer, async (tx) => {
      const id = await saveEntries(tx, viewer.employeeId, weekStartStr, formData);
      await tx.timesheet.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: viewer.employeeId,
          eventType: "TIMESHEET_SUBMIT",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: { timesheetId: id, status: "SUBMITTED", weekStart: weekStart(weekStartStr).toISOString().slice(0, 10) },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not submit the timesheet." };
  }
  revalidatePath("/timesheets");
  redirect("/timesheets");
}

// Dispatcher for the grid: one form, two submit buttons (name="intent"), useActionState for errors.
export async function saveOrSubmitTimesheet(weekStartStr, prevState, formData) {
  return formData.get("intent") === "submit"
    ? submitTimesheet(weekStartStr, prevState, formData)
    : saveTimesheetDraft(weekStartStr, prevState, formData);
}

// --- Reviewer decisions (manager-of-subject or HR; never your own) -------------------------------

// Approve a submitted timesheet → APPROVED + audit. Nothing else moves (hours were already logged).
export async function approveTimesheet(timesheetId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      const ts = await tx.timesheet.findUnique({ where: { id: timesheetId } }); // RLS-scoped
      if (!ts) throw new Error("Timesheet not found.");
      if (ts.status !== "SUBMITTED") throw new Error("Only a submitted timesheet can be reviewed.");
      if (!(await viewerCanApprove(viewer, ts.employeeId, tx))) {
        throw new Error("You are not authorized to review this timesheet.");
      }
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: { status: "APPROVED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: ts.employeeId,
          eventType: "TIMESHEET_APPROVE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { timesheetId, status: "SUBMITTED" },
          afterState: { timesheetId, status: "APPROVED" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not approve the timesheet." };
  }
  revalidatePath("/approvals");
  revalidatePath("/timesheets");
  redirect("/approvals");
}

// Reject a submitted timesheet → REJECTED + note + audit. The employee can then edit + resubmit
// (getCurrentTimesheet treats REJECTED as editable; saving reopens it to DRAFT).
export async function rejectTimesheet(timesheetId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      const ts = await tx.timesheet.findUnique({ where: { id: timesheetId } });
      if (!ts) throw new Error("Timesheet not found.");
      if (ts.status !== "SUBMITTED") throw new Error("Only a submitted timesheet can be reviewed.");
      if (!(await viewerCanApprove(viewer, ts.employeeId, tx))) {
        throw new Error("You are not authorized to review this timesheet.");
      }
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: { status: "REJECTED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: ts.employeeId,
          eventType: "TIMESHEET_REJECT",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { timesheetId, status: "SUBMITTED" },
          afterState: { timesheetId, status: "REJECTED" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not reject the timesheet." };
  }
  revalidatePath("/approvals");
  revalidatePath("/timesheets");
  redirect("/approvals");
}

// Dispatcher for the approvals inbox: one form, two buttons (name="intent" approve|reject).
export async function decideTimesheet(timesheetId, prevState, formData) {
  return formData.get("intent") === "reject"
    ? rejectTimesheet(timesheetId, prevState, formData)
    : approveTimesheet(timesheetId, prevState, formData);
}
