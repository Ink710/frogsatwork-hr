"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, canManageDepartments } from "@hris/auth";
import { departmentSchema } from "@hris/types";
import { departmentDescendantIds } from "@/lib/queries";

// Parse the shared department form. Empty selects/inputs arrive as "" — coerce to null/undefined
// so the schema treats them as "none"/"unset".
function parseForm(formData) {
  return departmentSchema.safeParse({
    name: formData.get("name"),
    parentDepartmentId: formData.get("parentDepartmentId") || null,
    headUserId: formData.get("headUserId") || null,
    budget: formData.get("budget") || undefined,
  });
}

// CREATE — HR_ADMIN. Department has no RLS, so a plain create works; the budget row (if any) goes
// through the RLS'd DepartmentBudget, which HR_ADMIN may write for any department.
export async function createDepartment(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canManageDepartments(viewer)) return { error: "You are not authorized." };

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  let newId;
  try {
    newId = await withViewer(viewer, async (tx) => {
      const dept = await tx.department.create({
        data: {
          name: input.name,
          orgId: viewer.orgId,
          parentDepartmentId: input.parentDepartmentId ?? null,
          headUserId: input.headUserId ?? null,
        },
        select: { id: true },
      });
      if (input.budget != null) {
        await tx.departmentBudget.create({ data: { departmentId: dept.id, budget: input.budget } });
      }
      return dept.id;
    });
  } catch (e) {
    return { error: e.message ?? "Could not create department." };
  }

  revalidatePath("/departments");
  redirect(`/departments/${newId}`);
}

// UPDATE — HR_ADMIN. Renames, re-parents (with a server-side cycle guard), re-heads, and
// sets/updates/clears the budget.
export async function updateDepartment(departmentId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canManageDepartments(viewer)) return { error: "You are not authorized." };

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      if (input.parentDepartmentId) {
        // Cycle guard: the new parent can't be the department itself or one of its descendants.
        // Recompute from the DB — the client's option list is only a hint.
        const all = await tx.department.findMany({
          where: { orgId: viewer.orgId },
          select: { id: true, parentDepartmentId: true },
        });
        const blocked = departmentDescendantIds(departmentId, all);
        if (blocked.has(input.parentDepartmentId)) {
          throw new Error("A department can't be nested under itself or one of its sub-departments.");
        }
      }

      await tx.department.update({
        where: { id: departmentId },
        data: {
          name: input.name,
          parentDepartmentId: input.parentDepartmentId ?? null,
          headUserId: input.headUserId ?? null,
        },
      });

      if (input.budget != null) {
        await tx.departmentBudget.upsert({
          where: { departmentId },
          create: { departmentId, budget: input.budget },
          update: { budget: input.budget },
        });
      } else {
        // Cleared → remove the row (budget is NOT NULL, so there's no "empty" state).
        await tx.departmentBudget.deleteMany({ where: { departmentId } });
      }
    });
  } catch (e) {
    return { error: e.message ?? "Could not update department." };
  }

  revalidatePath("/departments");
  revalidatePath(`/departments/${departmentId}`);
  redirect(`/departments/${departmentId}`);
}

// DELETE — HR_ADMIN, empty departments only. Employees and sub-departments must be reassigned
// first (the FK is ON DELETE RESTRICT; this is the friendly pre-check). Also drops the budget row.
export async function deleteDepartment(departmentId, _prevState) {
  const viewer = await getViewer();
  if (!viewer || !canManageDepartments(viewer)) return { error: "You are not authorized." };

  try {
    await withViewer(viewer, async (tx) => {
      const [employeeCount, childCount] = await Promise.all([
        tx.employee.count({ where: { departmentId } }),
        tx.department.count({ where: { parentDepartmentId: departmentId } }),
      ]);
      if (employeeCount > 0 || childCount > 0) {
        throw new Error("Reassign this department's employees and sub-departments before deleting it.");
      }
      await tx.departmentBudget.deleteMany({ where: { departmentId } });
      await tx.department.delete({ where: { id: departmentId } });
    });
  } catch (e) {
    return { error: e.message ?? "Could not delete department." };
  }

  revalidatePath("/departments");
  redirect("/departments");
}
