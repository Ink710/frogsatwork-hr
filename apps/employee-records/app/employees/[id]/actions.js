"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getViewer,
  withViewer,
  canEditEmployee,
  canEditCompensation,
  getSubtreeIds,
} from "@hris/auth";
import { employeeChangeSchema } from "@hris/types";

// Record an effective-dated change: close the current open history version and open a new
// one, atomically. `employeeId` is bound by the form; the (prevState, formData) shape is
// for useActionState. Returns { error } on failure; redirects on success.
export async function recordChange(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to edit." };

  const parsed = employeeChangeSchema.safeParse({
    jobTitle: formData.get("jobTitle"),
    employmentType: formData.get("employmentType"),
    departmentId: formData.get("departmentId"),
    managerId: formData.get("managerId") || null,
    salary: formData.get("salary") || undefined,
    currency: formData.get("currency") || undefined,
    effectiveFrom: formData.get("effectiveFrom"),
    changeReason: formData.get("changeReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      // Reload current state from the DB — never trust the form for what "current" is.
      const [current, employee] = await Promise.all([
        tx.employeeHistory.findFirst({
          where: { employeeId, effectiveTo: null },
          orderBy: { version: "desc" },
        }),
        tx.employee.findUnique({
          where: { id: employeeId },
          select: { departmentId: true, managerId: true },
        }),
      ]);
      if (!current || !employee) throw new Error("Employee record not found.");

      if (input.effectiveFrom <= current.effectiveFrom) {
        throw new Error("Effective date must be after the current version started.");
      }

      // Compensation is separately guarded: a salary change requires comp rights.
      const currentSalaryStr = current.salary.toString();
      const wantsSalaryChange = input.salary != null && input.salary !== currentSalaryStr;
      if (wantsSalaryChange && !canEditCompensation(viewer)) {
        throw new Error("You are not authorized to change compensation.");
      }
      const newSalary =
        canEditCompensation(viewer) && input.salary != null ? input.salary : currentSalaryStr;

      // Cycle guard: a new manager can't be the employee or anyone in their subtree.
      if (input.managerId) {
        if (input.managerId === employeeId) throw new Error("An employee can't manage themselves.");
        const subtree = await getSubtreeIds(employeeId, tx);
        if (subtree.has(input.managerId)) {
          throw new Error("That manager reports (directly or indirectly) to this employee — cycle.");
        }
      }

      // Snapshots capture labels as-of now.
      const dept = await tx.department.findUnique({
        where: { id: input.departmentId },
        select: { name: true },
      });
      let managerSnapshot = null;
      if (input.managerId) {
        const mgr = await tx.employee.findUnique({
          where: { id: input.managerId },
          select: { firstName: true, lastName: true },
        });
        managerSnapshot = mgr ? `${mgr.firstName} ${mgr.lastName}` : null;
      }

      // Which fields actually changed (drives changedFields + the audit before/after).
      const changed = [];
      const before = {};
      const after = {};
      const mark = (field, oldV, newV) => {
        if (String(oldV ?? "") !== String(newV ?? "")) {
          changed.push(field);
          before[field] = oldV ?? null;
          after[field] = newV ?? null;
        }
      };
      mark("jobTitle", current.jobTitle, input.jobTitle);
      mark("employmentType", current.employmentType, input.employmentType);
      mark("departmentId", employee.departmentId, input.departmentId);
      mark("managerId", employee.managerId, input.managerId ?? null);
      if (wantsSalaryChange) mark("salary", currentSalaryStr, newSalary);

      if (changed.length === 0) throw new Error("Nothing changed.");

      // 1. Close the current version.
      await tx.employeeHistory.update({
        where: { id: current.id },
        data: { effectiveTo: input.effectiveFrom },
      });
      // 2. Open the new version.
      await tx.employeeHistory.create({
        data: {
          employeeId,
          version: current.version + 1,
          jobTitle: input.jobTitle,
          employmentType: input.employmentType,
          salary: newSalary,
          currency: input.currency ?? current.currency,
          departmentSnapshot: dept?.name ?? current.departmentSnapshot,
          managerSnapshot,
          changedFields: changed,
          changeReason: input.changeReason ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
          changedById: viewer.userId,
        },
      });
      // 3. Sync the Employee current-state columns if dept/manager moved.
      if (changed.includes("departmentId") || changed.includes("managerId")) {
        await tx.employee.update({
          where: { id: employeeId },
          data: { departmentId: input.departmentId, managerId: input.managerId ?? null },
        });
      }
      // 4. Audit.
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "UPDATE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: before,
          afterState: after,
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not record the change." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}
