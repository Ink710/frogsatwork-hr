"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getViewer,
  withViewer,
  canEditEmployee,
  canEditCompensation,
  canTerminate,
  canRehire,
  getSubtreeIds,
} from "@hris/auth";
import { randomUUID } from "node:crypto";
import {
  employeeChangeSchema,
  nameEmailCorrectionSchema,
  materialCorrectionSchema,
  terminationSchema,
  rehireSchema,
  documentUploadSchema,
  employeeCreateSchema,
  isWithinCorrectionWindow,
} from "@hris/types";
import { storage } from "@/lib/storage";
import { getEmployeeAuditLog } from "@/lib/queries";

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

// CORRECTION — identity (name/email). Not a temporal event: updates the current value,
// no new version. Always allowed for HR, no date restriction. Audited as CORRECTION.
export async function correctIdentity(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to edit." };

  const parsed = nameEmailCorrectionSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const before = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (!before) throw new Error("Employee not found.");

      const changed = {};
      for (const k of ["firstName", "lastName", "email"]) {
        if (before[k] !== input[k]) changed[k] = { from: before[k], to: input[k] };
      }
      if (Object.keys(changed).length === 0) throw new Error("Nothing to correct.");

      await tx.employee.update({ where: { id: employeeId }, data: input });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "CORRECTION",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
          afterState: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not save the correction." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// CORRECTION — material fields, amended IN PLACE on the current version (no new version),
// allowed only within the grace window (anchored on the version's createdAt). Fixes a
// mis-entry; it is NOT a real change. Salary corrections still require comp rights.
export async function correctMaterial(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to edit." };

  const parsed = materialCorrectionSchema.safeParse({
    jobTitle: formData.get("jobTitle") || undefined,
    employmentType: formData.get("employmentType") || undefined,
    departmentId: formData.get("departmentId") || undefined,
    managerId: formData.get("managerId") ?? undefined, // "" means "None"
    salary: formData.get("salary") || undefined,
    changeReason: formData.get("changeReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;
  const managerProvided = formData.has("managerId");
  const managerId = formData.get("managerId") || null;

  try {
    await withViewer(viewer, async (tx) => {
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

      // The gate that makes this "fixing a typo" and not "rewriting history".
      if (!isWithinCorrectionWindow(current.createdAt)) {
        throw new Error("Correction window has closed for this record — record a forward-dated change instead.");
      }

      const salaryStr = current.salary.toString();
      const wantsSalary = input.salary != null && input.salary !== salaryStr;
      if (wantsSalary && !canEditCompensation(viewer)) {
        throw new Error("You are not authorized to correct compensation.");
      }
      if (managerProvided && managerId) {
        if (managerId === employeeId) throw new Error("An employee can't manage themselves.");
        const subtree = await getSubtreeIds(employeeId, tx);
        if (subtree.has(managerId)) throw new Error("That manager reports to this employee — cycle.");
      }

      const versionData = {};
      const empData = {};
      const before = {};
      const after = {};
      const mark = (field, oldV, newV, sink) => {
        if (String(oldV ?? "") !== String(newV ?? "")) {
          sink[field] = newV;
          before[field] = oldV ?? null;
          after[field] = newV ?? null;
        }
      };

      if (input.jobTitle != null) mark("jobTitle", current.jobTitle, input.jobTitle, versionData);
      if (input.employmentType != null)
        mark("employmentType", current.employmentType, input.employmentType, versionData);
      if (wantsSalary) mark("salary", salaryStr, input.salary, versionData);

      if (input.departmentId != null && input.departmentId !== employee.departmentId) {
        const dept = await tx.department.findUnique({
          where: { id: input.departmentId },
          select: { name: true },
        });
        mark("departmentId", employee.departmentId, input.departmentId, empData);
        versionData.departmentSnapshot = dept?.name ?? current.departmentSnapshot;
      }
      if (managerProvided && managerId !== employee.managerId) {
        let snap = null;
        if (managerId) {
          const mgr = await tx.employee.findUnique({
            where: { id: managerId },
            select: { firstName: true, lastName: true },
          });
          snap = mgr ? `${mgr.firstName} ${mgr.lastName}` : null;
        }
        mark("managerId", employee.managerId, managerId, empData);
        versionData.managerSnapshot = snap;
      }

      if (Object.keys(before).length === 0) throw new Error("Nothing to correct.");

      // Amend the current version IN PLACE — no version bump, effectiveFrom untouched.
      await tx.employeeHistory.update({ where: { id: current.id }, data: versionData });
      if (Object.keys(empData).length > 0) {
        await tx.employee.update({ where: { id: employeeId }, data: empData });
      }
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "CORRECTION",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: before,
          afterState: after,
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not save the correction." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// TERMINATE — soft delete. Set status + terminationDate + reason + rehire eligibility, and
// close the open history version (a terminated employee has no active/open version).
// The record is never removed. Only HR_ADMIN.
export async function terminateEmployee(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return { error: "You are not authorized to terminate." };

  const parsed = terminationSchema.safeParse({
    terminationDate: formData.get("terminationDate"),
    terminationReason: formData.get("terminationReason"),
    eligibleForRehire: formData.get("eligibleForRehire") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { employmentStatus: true },
      });
      if (!employee) throw new Error("Employee not found.");
      if (employee.employmentStatus === "TERMINATED") throw new Error("Employee is already terminated.");

      const current = await tx.employeeHistory.findFirst({
        where: { employeeId, effectiveTo: null },
        orderBy: { version: "desc" },
      });
      if (current) {
        await tx.employeeHistory.update({
          where: { id: current.id },
          data: { effectiveTo: input.terminationDate },
        });
      }
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          employmentStatus: "TERMINATED",
          terminationDate: input.terminationDate,
          terminationReason: input.terminationReason,
          eligibleForRehire: input.eligibleForRehire,
        },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "TERMINATE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { employmentStatus: employee.employmentStatus },
          afterState: {
            employmentStatus: "TERMINATED",
            terminationReason: input.terminationReason,
            eligibleForRehire: input.eligibleForRehire,
          },
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not terminate." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// REHIRE — reactivate a terminated (and rehire-eligible) employee. Opens a fresh active
// version carrying forward their last known state. Only HR_ADMIN.
export async function rehireEmployee(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canRehire(viewer)) return { error: "You are not authorized to rehire." };

  const parsed = rehireSchema.safeParse({ rehireDate: formData.get("rehireDate") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { employmentStatus: true, eligibleForRehire: true },
      });
      if (!employee) throw new Error("Employee not found.");
      if (employee.employmentStatus !== "TERMINATED") throw new Error("Only terminated employees can be rehired.");
      if (!employee.eligibleForRehire) throw new Error("This employee is marked not eligible for rehire.");

      const last = await tx.employeeHistory.findFirst({
        where: { employeeId },
        orderBy: { version: "desc" },
      });
      if (!last) throw new Error("No prior history to base the rehire on.");

      // A new OPEN version restores the invariant (one open row again).
      await tx.employeeHistory.create({
        data: {
          employeeId,
          version: last.version + 1,
          jobTitle: last.jobTitle,
          employmentType: last.employmentType,
          salary: last.salary,
          currency: last.currency,
          departmentSnapshot: last.departmentSnapshot,
          managerSnapshot: last.managerSnapshot,
          changedFields: ["rehire"],
          changeReason: "Rehire",
          effectiveFrom: input.rehireDate,
          effectiveTo: null,
          changedById: viewer.userId,
        },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { employmentStatus: "ACTIVE", rehireDate: input.rehireDate },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "REHIRE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { employmentStatus: "TERMINATED" },
          afterState: { employmentStatus: "ACTIVE" },
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not rehire." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// DOCUMENTS — upload (HR only). Store the file in private storage under a server-generated
// object key, then record the metadata. The DB never holds a public path.
export async function uploadDocument(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to upload." };

  const parsed = documentUploadSchema.safeParse({
    documentType: formData.get("documentType"),
    expiresAt: formData.get("expiresAt") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { error: "Choose a file." };
  if (file.size > 10 * 1024 * 1024) return { error: "File too large (max 10MB)." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const key = `employees/${employeeId}/${randomUUID()}-${safeName}`;
  await storage.put(key, buffer);

  try {
    await withViewer(viewer, (tx) =>
      tx.employeeDocument.create({
        data: {
          employeeId,
          documentType: parsed.data.documentType,
          fileName: file.name,
          fileUrl: key, // object key, not a public URL
          fileSizeBytes: file.size,
          uploadedById: viewer.userId,
          expiresAt: parsed.data.expiresAt ?? null,
        },
      }),
    );
  } catch (e) {
    await storage.remove(key); // don't leave an orphaned file if the insert fails
    return { error: e.message ?? "Upload failed." };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

// DOCUMENTS — delete (HR only). Remove the row (RLS-scoped) and the underlying file.
export async function deleteDocument(docId, _prevState) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized." };

  let removed;
  try {
    removed = await withViewer(viewer, async (tx) => {
      const doc = await tx.employeeDocument.findUnique({
        where: { id: docId },
        select: { id: true, employeeId: true, fileUrl: true },
      });
      if (!doc) throw new Error("Document not found.");
      await tx.employeeDocument.delete({ where: { id: docId } });
      return doc;
    });
  } catch (e) {
    return { error: e.message ?? "Delete failed." };
  }

  await storage.remove(removed.fileUrl);
  revalidatePath(`/employees/${removed.employeeId}`);
  return { ok: true };
}

// CREATE — the canonical new-hire flow (HR admin + generalist). Mints a User identity, the
// Employee, its initial history version, and a CREATE audit row, all in one transaction.
// This is the single authoritative creation path (the ATS "hire" flow will call it too).
export async function createEmployee(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to create employees." };

  const parsed = employeeCreateSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    hireDate: formData.get("hireDate"),
    departmentId: formData.get("departmentId"),
    managerId: formData.get("managerId") || null,
    jobTitle: formData.get("jobTitle"),
    employmentType: formData.get("employmentType"),
    role: formData.get("role") || "EMPLOYEE",
    salary: formData.get("salary") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;
  // Salary only honored for comp-editors; otherwise the record starts at 0.00 (set later).
  const salary = canEditCompensation(viewer) && input.salary ? input.salary : "0.00";

  let newId;
  try {
    newId = await withViewer(viewer, async (tx) => {
      // Next employee number in the org (unique constraint backstops races).
      const existing = await tx.employee.findMany({
        where: { orgId: viewer.orgId },
        select: { employeeNumber: true },
      });
      const max = existing.reduce((m, e) => {
        const n = parseInt(String(e.employeeNumber).replace(/\D/g, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      const employeeNumber = `E-${String(max + 1).padStart(4, "0")}`;

      const dept = await tx.department.findUnique({
        where: { id: input.departmentId },
        select: { name: true },
      });
      if (!dept) throw new Error("Department not found.");
      let managerSnapshot = null;
      if (input.managerId) {
        const mgr = await tx.employee.findUnique({
          where: { id: input.managerId },
          select: { firstName: true, lastName: true },
        });
        managerSnapshot = mgr ? `${mgr.firstName} ${mgr.lastName}` : null;
      }

      // 1. Login identity (no password yet → login enabled once a password/invite flow exists).
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: `${input.firstName} ${input.lastName}`,
          role: input.role,
          orgId: viewer.orgId,
        },
      });
      // 2. Employee. We generate the id and use a raw INSERT (no RETURNING) on purpose:
      // Prisma's create() does INSERT … RETURNING, and the RETURNING makes Postgres apply
      // the SELECT policy to the brand-new row, which app_can_see_employee() can't see
      // mid-insert. A plain INSERT is admitted by the employee_insert WITH CHECK policy; the
      // history/audit creates below then work because the row now exists.
      const employeeId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "Employee"
          (id, "employeeNumber", "firstName", "lastName", email, "employmentStatus",
           "hireDate", "userId", "orgId", "departmentId", "managerId", "createdAt", "updatedAt")
        VALUES
          (${employeeId}, ${employeeNumber}, ${input.firstName}, ${input.lastName}, ${input.email},
           ${"ACTIVE"}::"EmploymentStatus", ${input.hireDate}, ${user.id}, ${viewer.orgId},
           ${input.departmentId}, ${input.managerId ?? null}, now(), now())`;
      // 3. Initial version.
      await tx.employeeHistory.create({
        data: {
          employeeId,
          version: 1,
          jobTitle: input.jobTitle,
          employmentType: input.employmentType,
          salary,
          currency: "USD",
          departmentSnapshot: dept.name,
          managerSnapshot,
          changedFields: ["initial"],
          changeReason: "New hire",
          effectiveFrom: input.hireDate,
          effectiveTo: null,
          changedById: viewer.userId,
        },
      });
      // 4. Audit.
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "CREATE",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: {
            employeeNumber,
            name: `${input.firstName} ${input.lastName}`,
            jobTitle: input.jobTitle,
          },
        },
      });
      return employeeId;
    });
  } catch (e) {
    const msg = /unique/i.test(e.message ?? "") ? "That email is already in use." : e.message ?? "Could not create employee.";
    return { error: msg };
  }

  revalidatePath("/employees");
  redirect(`/employees/${newId}`);
}

// Read-only action powering the audit page's "Load more". All authorization lives in the
// query (RLS scopes the rows, comp redaction scrubs the payloads) — the client only holds
// an opaque cursor, and nothing it sends is trusted.
export async function loadMoreAuditLog(employeeId, cursor) {
  const result = await getEmployeeAuditLog(employeeId, cursor);
  if (!result) return { error: "Not available." };
  return { events: result.events, nextCursor: result.nextCursor };
}
