"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, isHrRole } from "@hris/auth";
import { meetingSchema } from "@hris/workable-hours";
import { canManageMeetings } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  // Never surface internal DB errors (Prisma throws PrismaClient* errors) — only intentional messages.
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

function parseMeeting(formData) {
  return meetingSchema.safeParse({
    name: formData.get("name"),
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  });
}

// Load a meeting the viewer may manage (their own; HR any in-org), or throw. Shared by the mutating
// actions so the "only your own meeting" rule lives in one place — the app-layer half of the guard
// (Meeting has no RLS; the assignment table does). Mirrors requireManageableProject.
async function requireManageableMeeting(tx, viewer, meetingId, t) {
  const meeting = await tx.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!meeting || meeting.orgId !== viewer.orgId) throw new Error(t("err.meetingNotFound"));
  if (!isHrRole(viewer.role) && meeting.createdById !== viewer.userId) throw new Error(t("err.meetingNotFound"));
  return meeting;
}

// Create a recurring meeting for the viewer's org (managers/HR). The creator owns it.
export async function createMeeting(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageMeetings(viewer)) return { error: t("err.notAuthorizedMeetings") };
  const parsed = parseMeeting(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, (tx) =>
      tx.meeting.create({
        data: {
          orgId: viewer.orgId,
          createdById: viewer.userId,
          name: parsed.data.name,
          dayOfWeek: parsed.data.dayOfWeek,
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
          status: "ACTIVE",
        },
      }),
    );
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.meetingCreateFailed") };
  }
  revalidatePath("/meetings");
  redirect("/meetings");
}

// Edit a meeting's name / weekday / time (owner or HR).
export async function updateMeeting(meetingId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageMeetings(viewer)) return { error: t("err.notAuthorizedMeetings") };
  const parsed = parseMeeting(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableMeeting(tx, viewer, meetingId, t);
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          name: parsed.data.name,
          dayOfWeek: parsed.data.dayOfWeek,
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.meetingUpdateFailed") };
  }
  revalidatePath("/meetings");
  redirect(`/meetings/${meetingId}`);
}

// Flip a meeting ACTIVE ↔ ARCHIVED (owner or HR). Archived meetings drop out of the employee picker
// but keep their historical TimeEntry references (never hard-deleted). Mirrors toggleProjectStatus.
export async function toggleMeetingStatus(meetingId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageMeetings(viewer)) return { error: t("err.notAuthorizedMeetings") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableMeeting(tx, viewer, meetingId, t);
      const m = await tx.meeting.findUnique({ where: { id: meetingId }, select: { status: true } });
      await tx.meeting.update({ where: { id: meetingId }, data: { status: m.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.meetingArchiveFailed") };
  }
  revalidatePath("/meetings");
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}

// Assign an employee to a meeting (owner or HR). The target must be visible to the viewer under RLS
// (a manager → their subtree); the assignment table's WITH CHECK is the DB-level backstop.
export async function assignToMeeting(meetingId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageMeetings(viewer)) return { error: t("err.notAuthorizedMeetings") };
  const employeeId = formData.get("employeeId");
  if (!employeeId) return { error: t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableMeeting(tx, viewer, meetingId, t);
      // RLS-scoped lookup: null if the target isn't in the viewer's scope (a manager's subtree).
      const emp = await tx.employee.findFirst({ where: { id: employeeId, employmentStatus: "ACTIVE" }, select: { id: true } });
      if (!emp) throw new Error(t("err.employeeNotAssignable"));
      const existing = await tx.meetingAssignment.findFirst({ where: { meetingId, employeeId } });
      if (existing) throw new Error(t("err.alreadyAssignedMeeting"));
      await tx.meetingAssignment.create({ data: { meetingId, employeeId, assignedById: viewer.userId } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.assignFailed") };
  }
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}

// Remove an assignment (owner or HR). deleteMany is RLS-scoped, so a hidden row simply isn't deleted.
export async function unassignFromMeeting(meetingId, assignmentId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageMeetings(viewer)) return { error: t("err.notAuthorizedMeetings") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableMeeting(tx, viewer, meetingId, t);
      const { count } = await tx.meetingAssignment.deleteMany({ where: { id: assignmentId, meetingId } });
      if (count === 0) throw new Error(t("err.assignmentNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.unassignFailed") };
  }
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}
