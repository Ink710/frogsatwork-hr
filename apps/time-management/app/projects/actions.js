"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, isHrRole } from "@hris/auth";
import { projectSchema } from "@hris/workable-hours";
import { canManageProjects } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  // Never surface internal DB errors (Prisma throws PrismaClient* errors) — only intentional messages.
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

function parseProject(formData) {
  return projectSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code") || undefined,
  });
}

// Load a project the viewer may manage (their own; HR any in-org), or throw. Shared by the mutating
// actions so the "only your own project" rule lives in one place — the app-layer half of the guard
// (Project has no RLS; the assignment table does).
async function requireManageableProject(tx, viewer, projectId, t) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!project || project.orgId !== viewer.orgId) throw new Error(t("err.projectNotFound"));
  if (!isHrRole(viewer.role) && project.createdById !== viewer.userId) throw new Error(t("err.projectNotFound"));
  return project;
}

// Create a project for the viewer's org (managers/HR). The creator owns it.
export async function createProject(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageProjects(viewer)) return { error: t("err.notAuthorizedProjects") };
  const parsed = parseProject(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, (tx) =>
      tx.project.create({
        data: {
          orgId: viewer.orgId,
          createdById: viewer.userId,
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          status: "ACTIVE",
        },
      }),
    );
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.projectCreateFailed") };
  }
  revalidatePath("/projects");
  redirect("/projects");
}

// Rename / recode a project (owner or HR).
export async function updateProject(projectId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageProjects(viewer)) return { error: t("err.notAuthorizedProjects") };
  const parsed = parseProject(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableProject(tx, viewer, projectId, t);
      await tx.project.update({ where: { id: projectId }, data: { name: parsed.data.name, code: parsed.data.code ?? null } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.projectUpdateFailed") };
  }
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

// Flip a project ACTIVE ↔ ARCHIVED (owner or HR). Archived projects drop out of the employee picker
// but keep their historical TimeEntry references (never hard-deleted).
export async function toggleProjectStatus(projectId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageProjects(viewer)) return { error: t("err.notAuthorizedProjects") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableProject(tx, viewer, projectId, t);
      const p = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
      await tx.project.update({ where: { id: projectId }, data: { status: p.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.projectArchiveFailed") };
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

// Assign an employee to a project (owner or HR). The target must be visible to the viewer under RLS
// (a manager → their subtree); the assignment table's WITH CHECK is the DB-level backstop.
export async function assignToProject(projectId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageProjects(viewer)) return { error: t("err.notAuthorizedProjects") };
  const employeeId = formData.get("employeeId");
  if (!employeeId) return { error: t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableProject(tx, viewer, projectId, t);
      // RLS-scoped lookup: null if the target isn't in the viewer's scope (a manager's subtree).
      const emp = await tx.employee.findFirst({ where: { id: employeeId, employmentStatus: "ACTIVE" }, select: { id: true } });
      if (!emp) throw new Error(t("err.employeeNotAssignable"));
      const existing = await tx.projectAssignment.findFirst({ where: { projectId, employeeId } });
      if (existing) throw new Error(t("err.alreadyAssigned"));
      await tx.projectAssignment.create({ data: { projectId, employeeId, assignedById: viewer.userId } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.assignFailed") };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

// Remove an assignment (owner or HR). deleteMany is RLS-scoped, so a hidden row simply isn't deleted.
export async function unassignFromProject(projectId, assignmentId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageProjects(viewer)) return { error: t("err.notAuthorizedProjects") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableProject(tx, viewer, projectId, t);
      const { count } = await tx.projectAssignment.deleteMany({ where: { id: assignmentId, projectId } });
      if (count === 0) throw new Error(t("err.assignmentNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.unassignFailed") };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
