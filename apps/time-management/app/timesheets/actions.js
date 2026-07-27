"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { timesheetEntriesSchema, decisionSchema, weekStart } from "@hris/workable-hours";
import { viewerCanApprove } from "@/lib/approvals";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  return e instanceof Error ? e.message : undefined;
}

// Persist one week's grid: ensure a DRAFT timesheet exists (a REJECTED one reopens to DRAFT), then
// replace its day rows with the non-zero entries. Returns the timesheet id. Runs inside a withViewer
// tx so RLS admits the writes (an employee editing their own). Throws on a locked/invalid week.
async function saveEntries(tx, subjectId, weekStartStr, formData, t) {
  let raw;
  try {
    raw = JSON.parse(formData.get("entries") || "[]");
  } catch {
    throw new Error(t("err.timesheetRead"));
  }
  const parsed = timesheetEntriesSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? t("err.invalidEntries"));

  // Don't trust the client's projectIds: every tagged project must be one the employee is actively
  // assigned to (the picker only offers those, but the action is the real gate).
  const projectIds = [...new Set(parsed.data.map((e) => e.projectId).filter(Boolean))];
  if (projectIds.length) {
    const assigned = await tx.projectAssignment.findMany({
      where: { employeeId: subjectId, projectId: { in: projectIds }, project: { status: "ACTIVE" } },
      select: { projectId: true },
    });
    const ok = new Set(assigned.map((a) => a.projectId));
    if (projectIds.some((id) => !ok.has(id))) throw new Error(t("err.notAssignedToProject"));
  }

  // Same gate for meeting tags (M10): every tagged meeting must be one the employee is actively assigned to.
  const meetingIds = [...new Set(parsed.data.map((e) => e.meetingId).filter(Boolean))];
  if (meetingIds.length) {
    const assigned = await tx.meetingAssignment.findMany({
      where: { employeeId: subjectId, meetingId: { in: meetingIds }, meeting: { status: "ACTIVE" } },
      select: { meetingId: true },
    });
    const ok = new Set(assigned.map((a) => a.meetingId));
    if (meetingIds.some((id) => !ok.has(id))) throw new Error(t("err.notAssignedToMeeting"));
  }

  const ws = weekStart(weekStartStr);
  const we = new Date(ws);
  we.setUTCDate(we.getUTCDate() + 6);

  const existing = await tx.timesheet.findUnique({
    where: { employeeId_periodStart: { employeeId: subjectId, periodStart: ws } },
  });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
    throw new Error(t("err.weekAlreadySubmitted"));
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
      projectId: e.projectId ?? null,
      meetingId: e.meetingId ?? null,
      note: e.note ?? null,
    }));
  if (rows.length) await tx.timeEntry.createMany({ data: rows });
  return timesheet.id;
}

// Save the current grid as a DRAFT (no status change, no audit).
export async function saveTimesheetDraft(weekStartStr, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: t("err.noEmployeeRecord") };
  try {
    await withViewer(viewer, (tx) => saveEntries(tx, viewer.employeeId, weekStartStr, formData, t));
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.timesheetSaveFailed") };
  }
  revalidatePath("/timesheets");
  redirect("/timesheets");
}

// Save the grid AND submit it for approval (DRAFT/REJECTED → SUBMITTED + audit). You submit your own.
export async function submitTimesheet(weekStartStr, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: t("err.noEmployeeRecord") };
  try {
    await withViewer(viewer, async (tx) => {
      const id = await saveEntries(tx, viewer.employeeId, weekStartStr, formData, t);
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
    return { error: errorMessage(e) ?? t("err.timesheetSubmitFailed") };
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
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.signedIn") };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const ts = await tx.timesheet.findUnique({ where: { id: timesheetId } }); // RLS-scoped
      if (!ts) throw new Error(t("err.timesheetNotFound"));
      if (ts.status !== "SUBMITTED") throw new Error(t("err.onlySubmittedReviewed"));
      if (!(await viewerCanApprove(viewer, ts.employeeId, tx))) {
        throw new Error(t("err.notAuthorizedReviewTimesheet"));
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
    return { error: errorMessage(e) ?? t("err.timesheetApproveFailed") };
  }
  revalidatePath("/approvals");
  revalidatePath("/timesheets");
  redirect("/approvals");
}

// Reject a submitted timesheet → REJECTED + note + audit. The employee can then edit + resubmit
// (getCurrentTimesheet treats REJECTED as editable; saving reopens it to DRAFT).
export async function rejectTimesheet(timesheetId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.signedIn") };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const ts = await tx.timesheet.findUnique({ where: { id: timesheetId } });
      if (!ts) throw new Error(t("err.timesheetNotFound"));
      if (ts.status !== "SUBMITTED") throw new Error(t("err.onlySubmittedReviewed"));
      if (!(await viewerCanApprove(viewer, ts.employeeId, tx))) {
        throw new Error(t("err.notAuthorizedReviewTimesheet"));
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
    return { error: errorMessage(e) ?? t("err.timesheetRejectFailed") };
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

// Manager/HR adjustment of a report's SUBMITTED timesheet during review (M9). Gated viewerCanApprove;
// only a SUBMITTED sheet may be edited (not the employee's DRAFT, not an APPROVED/locked one); status
// is left SUBMITTED (approve/reject stay separate). projectIds must belong to the TARGET's active
// assignments. Audited as TIMESHEET_ADJUST (before/after totals) — someone else altering your hours.
export async function adjustTimesheet(employeeId, weekStartStr, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.signedIn") };
  let raw;
  try {
    raw = JSON.parse(formData.get("entries") || "[]");
  } catch {
    return { error: t("err.timesheetRead") };
  }
  const parsed = timesheetEntriesSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidEntries") };
  const round2 = (n) => Math.round(n * 100) / 100;

  try {
    await withViewer(viewer, async (tx) => {
      if (!(await viewerCanApprove(viewer, employeeId, tx))) throw new Error(t("err.notAuthorizedReviewTimesheet"));
      const ws = weekStart(weekStartStr);
      const sheet = await tx.timesheet.findUnique({
        where: { employeeId_periodStart: { employeeId, periodStart: ws } },
        include: { entries: { select: { hours: true } } },
      });
      if (!sheet) throw new Error(t("err.timesheetNotFound"));
      if (sheet.status !== "SUBMITTED") throw new Error(t("err.onlySubmittedAdjust"));

      // projectIds must be ones the TARGET is actively assigned to.
      const projectIds = [...new Set(parsed.data.map((e) => e.projectId).filter(Boolean))];
      if (projectIds.length) {
        const assigned = await tx.projectAssignment.findMany({
          where: { employeeId, projectId: { in: projectIds }, project: { status: "ACTIVE" } },
          select: { projectId: true },
        });
        const ok = new Set(assigned.map((a) => a.projectId));
        if (projectIds.some((id) => !ok.has(id))) throw new Error(t("err.notAssignedToProject"));
      }
      // meetingIds must be ones the TARGET is actively assigned to.
      const meetingIds = [...new Set(parsed.data.map((e) => e.meetingId).filter(Boolean))];
      if (meetingIds.length) {
        const assigned = await tx.meetingAssignment.findMany({
          where: { employeeId, meetingId: { in: meetingIds }, meeting: { status: "ACTIVE" } },
          select: { meetingId: true },
        });
        const ok = new Set(assigned.map((a) => a.meetingId));
        if (meetingIds.some((id) => !ok.has(id))) throw new Error(t("err.notAssignedToMeeting"));
      }

      const beforeTotal = round2(sheet.entries.reduce((s, e) => s + Number(e.hours), 0));
      await tx.timeEntry.deleteMany({ where: { timesheetId: sheet.id } });
      const rows = parsed.data
        .filter((e) => e.hours > 0)
        .map((e) => ({
          timesheetId: sheet.id,
          employeeId,
          workDate: new Date(`${e.workDate}T00:00:00.000Z`),
          hours: e.hours.toFixed(2),
          projectId: e.projectId ?? null,
          meetingId: e.meetingId ?? null,
          note: e.note ?? null,
        }));
      if (rows.length) await tx.timeEntry.createMany({ data: rows });
      const afterTotal = round2(rows.reduce((s, e) => s + Number(e.hours), 0));

      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "TIMESHEET_ADJUST",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { timesheetId: sheet.id, total: beforeTotal },
          afterState: { timesheetId: sheet.id, total: afterTotal },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.adjustFailed") };
  }
  revalidatePath(`/my-team/${employeeId}`);
  revalidatePath("/approvals");
  return { ok: true };
}
