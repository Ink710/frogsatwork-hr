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
  detailsCorrectionSchema,
  materialCorrectionSchema,
  terminationSchema,
  rehireSchema,
  startStatusChangeSchema,
  reinstateSchema,
  documentUploadSchema,
  employeeCreateSchema,
  emergencyContactSchema,
  isWithinCorrectionWindow,
} from "@hris/types";
import { storage } from "@/lib/storage";
import { getEmployeeAuditLog } from "@/lib/queries";
import { sendInvite } from "@/lib/invite";

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
    flsaClassification: formData.get("flsaClassification") || undefined,
    payFrequency: formData.get("payFrequency") || undefined,
    salary: formData.get("salary") || undefined,
    payBasis: formData.get("payBasis") || undefined,
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

      // Compensation is separately guarded: a salary or pay-basis change requires comp rights.
      const canComp = canEditCompensation(viewer);
      const currentSalaryStr = current.salary.toString();
      const wantsSalaryChange = input.salary != null && input.salary !== currentSalaryStr;
      const wantsPayBasisChange = input.payBasis != null && input.payBasis !== current.payBasis;
      if ((wantsSalaryChange || wantsPayBasisChange) && !canComp) {
        throw new Error("You are not authorized to change compensation.");
      }
      const newSalary = canComp && input.salary != null ? input.salary : currentSalaryStr;
      const newPayBasis = canComp && input.payBasis != null ? input.payBasis : current.payBasis;
      // FLSA + pay frequency aren't comp-secret; carry forward the current value if omitted.
      const newFlsa = input.flsaClassification ?? current.flsaClassification;
      const newPayFrequency = input.payFrequency ?? current.payFrequency;

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
      mark("flsaClassification", current.flsaClassification, newFlsa);
      mark("payFrequency", current.payFrequency, newPayFrequency);
      if (wantsSalaryChange) mark("salary", currentSalaryStr, newSalary);
      if (wantsPayBasisChange) mark("payBasis", current.payBasis, newPayBasis);

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
          flsaClassification: newFlsa,
          payFrequency: newPayFrequency,
          salary: newSalary,
          payBasis: newPayBasis,
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

// CORRECTION — current-state details (name/email + phone/location/schedule/timezone, and the
// comp-sensitive review dates + equity). Not a temporal event: updates current values, no new
// version. Only fields actually PRESENT in the submitted form are touched (formData.has), so a
// partial form never blanks a field it didn't render. Comp-sensitive fields are applied only for
// comp-editors. Audited as CORRECTION; the comp keys are redacted in the audit query for viewers
// who can't see compensation.
export async function correctDetails(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized to edit." };
  const canComp = canEditCompensation(viewer);

  const parsed = detailsCorrectionSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
    location: formData.get("location") ?? undefined,
    workSchedule: formData.get("workSchedule") ?? undefined,
    timeZone: formData.get("timeZone") ?? undefined,
    lastReviewDate: formData.get("lastReviewDate") || undefined,
    nextReviewDate: formData.get("nextReviewDate") || undefined,
    equityNote: formData.get("equityNote") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  // Empty string clears a nullable field.
  const nz = (v) => (v == null || v === "" ? null : v);

  try {
    await withViewer(viewer, async (tx) => {
      const before = await tx.employee.findUnique({
        where: { id: employeeId },
        select: {
          firstName: true, lastName: true, email: true,
          phone: true, location: true, workSchedule: true, timeZone: true,
          lastReviewDate: true, nextReviewDate: true, equityNote: true,
        },
      });
      if (!before) throw new Error("Employee not found.");

      // Build the update only from fields the form actually submitted.
      const next = { firstName: input.firstName, lastName: input.lastName, email: input.email };
      if (formData.has("phone")) next.phone = nz(input.phone);
      if (formData.has("location")) next.location = nz(input.location);
      if (formData.has("workSchedule")) next.workSchedule = nz(input.workSchedule);
      if (formData.has("timeZone")) next.timeZone = nz(input.timeZone);
      // Comp-sensitive: only a comp-editor may change these (others' values are ignored, not applied).
      if (canComp) {
        if (formData.has("lastReviewDate")) next.lastReviewDate = input.lastReviewDate ?? null;
        if (formData.has("nextReviewDate")) next.nextReviewDate = input.nextReviewDate ?? null;
        if (formData.has("equityNote")) next.equityNote = nz(input.equityNote);
      }

      // Diff for the audit. Dates compare by time; store as ISO date strings.
      const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
      const same = (a, b) =>
        a instanceof Date || b instanceof Date
          ? (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
          : (a ?? "") === (b ?? "");
      const beforeState = {};
      const afterState = {};
      for (const k of Object.keys(next)) {
        if (!same(before[k], next[k])) {
          beforeState[k] = iso(before[k]) ?? null;
          afterState[k] = iso(next[k]) ?? null;
        }
      }
      if (Object.keys(afterState).length === 0) throw new Error("Nothing to correct.");

      await tx.employee.update({ where: { id: employeeId }, data: next });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "CORRECTION",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState,
          afterState,
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
    flsaClassification: formData.get("flsaClassification") || undefined,
    payFrequency: formData.get("payFrequency") || undefined,
    salary: formData.get("salary") || undefined,
    payBasis: formData.get("payBasis") || undefined,
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
      const wantsPayBasis = input.payBasis != null && input.payBasis !== current.payBasis;
      if ((wantsSalary || wantsPayBasis) && !canEditCompensation(viewer)) {
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
      if (input.flsaClassification != null)
        mark("flsaClassification", current.flsaClassification, input.flsaClassification, versionData);
      if (input.payFrequency != null)
        mark("payFrequency", current.payFrequency, input.payFrequency, versionData);
      if (wantsSalary) mark("salary", salaryStr, input.salary, versionData);
      if (wantsPayBasis) mark("payBasis", current.payBasis, input.payBasis, versionData);

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

// PLACE ON LEAVE / SUSPEND — a reversible status change. Records a span row (retained
// forever), flips the status, and audits it. Only HR_ADMIN. Deliberately does NOT close the
// open EmployeeHistory version — status is not a versioned field (they keep title/salary).
// The reason is NOT written to the audit JSON: the audit viewer is RLS-scoped and the subject
// can read their own rows, so putting the reason there would leak it (unlike terminate, whose
// subject can't log in).
export async function startStatusChange(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return { error: "You are not authorized to change status." };

  const parsed = startStatusChangeSchema.safeParse({
    type: formData.get("type"),
    reason: formData.get("reason"),
    startDate: formData.get("startDate"),
    expectedEnd: formData.get("expectedEnd") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;
  const newStatus = input.type === "LEAVE" ? "ON_LEAVE" : "SUSPENDED";

  try {
    await withViewer(viewer, async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { employmentStatus: true },
      });
      if (!employee) throw new Error("Employee not found.");
      // One open span at a time: you can only start from ACTIVE.
      if (employee.employmentStatus !== "ACTIVE") {
        throw new Error("Only an active employee can be placed on leave or suspended.");
      }

      await tx.employeeStatusChange.create({
        data: {
          employeeId,
          type: input.type,
          reason: input.reason,
          startDate: input.startDate,
          expectedEnd: input.expectedEnd ?? null,
          createdById: viewer.userId,
        },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { employmentStatus: newStatus },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: input.type === "LEAVE" ? "LEAVE" : "SUSPEND",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { employmentStatus: "ACTIVE" },
          // No reason here — see the note above. Just the transition + when.
          afterState: { employmentStatus: newStatus, startDate: input.startDate },
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not change status." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// RETURN TO ACTIVE — close the open leave/suspension span and flip the status back. Only
// HR_ADMIN. Audited (REINSTATE). Also does not touch EmployeeHistory.
export async function reinstateEmployee(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return { error: "You are not authorized to change status." };

  const parsed = reinstateSchema.safeParse({ returnDate: formData.get("returnDate") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { employmentStatus: true },
      });
      if (!employee) throw new Error("Employee not found.");
      if (employee.employmentStatus !== "ON_LEAVE" && employee.employmentStatus !== "SUSPENDED") {
        throw new Error("Only an employee on leave or suspended can be returned to active.");
      }

      const open = await tx.employeeStatusChange.findFirst({
        where: { employeeId, endDate: null },
        orderBy: { startDate: "desc" },
      });
      if (!open) throw new Error("No open leave or suspension to close.");
      if (input.returnDate < open.startDate) {
        throw new Error("Return date can't be before the status started.");
      }

      await tx.employeeStatusChange.update({
        where: { id: open.id },
        data: { endDate: input.returnDate },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { employmentStatus: "ACTIVE" },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId,
          eventType: "REINSTATE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { employmentStatus: employee.employmentStatus },
          afterState: { employmentStatus: "ACTIVE", returnDate: input.returnDate },
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not return to active." };
  }

  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

// EMERGENCY CONTACTS — add / edit / delete. Writable by HR OR the employee themselves (managers
// can VIEW their reports' contacts via RLS but must NOT edit — the app-layer gate below is what
// enforces that; RLS alone would let them through). Invariant: at least one contact at all times.

// Shared gate. Needs the runtime employeeId (not just a role), so it's inline, not a predicate.
function canManageContacts(viewer, employeeId) {
  return canEditEmployee(viewer) || viewer.employeeId === employeeId;
}

export async function addEmergencyContact(employeeId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canManageContacts(viewer, employeeId)) return { error: "You are not authorized." };

  const parsed = emergencyContactSchema.safeParse({
    name: formData.get("name"),
    relationship: formData.get("relationship"),
    phone: formData.get("phone"),
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const count = await tx.emergencyContact.count({ where: { employeeId } });
      // The first contact is always primary; otherwise honor the checkbox.
      const makePrimary = count === 0 ? true : input.isPrimary;
      if (makePrimary) {
        await tx.emergencyContact.updateMany({ where: { employeeId }, data: { isPrimary: false } });
      }
      await tx.emergencyContact.create({
        data: {
          employeeId,
          name: input.name,
          relationship: input.relationship,
          phone: input.phone,
          isPrimary: makePrimary,
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not add contact." };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

export async function updateEmergencyContact(contactId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You are not authorized." };

  const parsed = emergencyContactSchema.safeParse({
    name: formData.get("name"),
    relationship: formData.get("relationship"),
    phone: formData.get("phone"),
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  let employeeId;
  try {
    await withViewer(viewer, async (tx) => {
      // Derive employeeId from the contact (RLS-scoped) — never trust the client for it.
      const existing = await tx.emergencyContact.findUnique({
        where: { id: contactId },
        select: { employeeId: true },
      });
      if (!existing) throw new Error("Contact not found.");
      employeeId = existing.employeeId;
      if (!canManageContacts(viewer, employeeId)) throw new Error("You are not authorized.");

      if (input.isPrimary) {
        await tx.emergencyContact.updateMany({ where: { employeeId }, data: { isPrimary: false } });
      }
      await tx.emergencyContact.update({
        where: { id: contactId },
        data: {
          name: input.name,
          relationship: input.relationship,
          phone: input.phone,
          isPrimary: input.isPrimary,
        },
      });
    });
  } catch (e) {
    return { error: e.message ?? "Could not update contact." };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

export async function deleteEmergencyContact(contactId, _prevState) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You are not authorized." };

  let employeeId;
  try {
    await withViewer(viewer, async (tx) => {
      const existing = await tx.emergencyContact.findUnique({
        where: { id: contactId },
        select: { employeeId: true, isPrimary: true },
      });
      if (!existing) throw new Error("Contact not found.");
      employeeId = existing.employeeId;
      if (!canManageContacts(viewer, employeeId)) throw new Error("You are not authorized.");

      const count = await tx.emergencyContact.count({ where: { employeeId } });
      if (count <= 1) throw new Error("You must keep at least one emergency contact.");

      await tx.emergencyContact.delete({ where: { id: contactId } });

      // Never leave zero primaries: if we removed the primary, promote another.
      if (existing.isPrimary) {
        const next = await tx.emergencyContact.findFirst({ where: { employeeId } });
        if (next) {
          await tx.emergencyContact.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }
    });
  } catch (e) {
    return { error: e.message ?? "Could not delete contact." };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
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
    flsaClassification: formData.get("flsaClassification") || undefined,
    payFrequency: formData.get("payFrequency") || undefined,
    salary: formData.get("salary") || undefined,
    payBasis: formData.get("payBasis") || undefined,
    phone: formData.get("phone") || undefined,
    location: formData.get("location") || undefined,
    workSchedule: formData.get("workSchedule") || undefined,
    timeZone: formData.get("timeZone") || undefined,
    lastReviewDate: formData.get("lastReviewDate") || undefined,
    nextReviewDate: formData.get("nextReviewDate") || undefined,
    equityNote: formData.get("equityNote") || undefined,
    emergencyContactName: formData.get("emergencyContactName"),
    emergencyContactRelationship: formData.get("emergencyContactRelationship"),
    emergencyContactPhone: formData.get("emergencyContactPhone"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;
  // Compensation fields only honored for comp-editors; otherwise salary starts at 0.00 and the
  // comp-sensitive fields (payBasis / review dates / equity) start empty (set later by payroll).
  const canComp = canEditCompensation(viewer);
  const salary = canComp && input.salary ? input.salary : "0.00";
  const payBasis = canComp ? (input.payBasis ?? null) : null;
  const lastReviewDate = canComp ? (input.lastReviewDate ?? null) : null;
  const nextReviewDate = canComp ? (input.nextReviewDate ?? null) : null;
  const equityNote = canComp ? (input.equityNote ?? null) : null;

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

      // 1. Login identity (no password yet). They can't log in until they set a password via
      // the invite email sent right after this transaction commits (see sendInvite below).
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
           "hireDate", "userId", "orgId", "departmentId", "managerId",
           location, phone, "workSchedule", "timeZone", "lastReviewDate", "nextReviewDate", "equityNote",
           "createdAt", "updatedAt")
        VALUES
          (${employeeId}, ${employeeNumber}, ${input.firstName}, ${input.lastName}, ${input.email},
           ${"ACTIVE"}::"EmploymentStatus", ${input.hireDate}, ${user.id}, ${viewer.orgId},
           ${input.departmentId}, ${input.managerId ?? null},
           ${input.location ?? null}, ${input.phone ?? null}, ${input.workSchedule ?? null},
           ${input.timeZone ?? null}, ${lastReviewDate}, ${nextReviewDate}, ${equityNote},
           now(), now())`;
      // 3. Initial version.
      await tx.employeeHistory.create({
        data: {
          employeeId,
          version: 1,
          jobTitle: input.jobTitle,
          employmentType: input.employmentType,
          flsaClassification: input.flsaClassification ?? null,
          payFrequency: input.payFrequency ?? null,
          salary,
          payBasis,
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
      // 5. Emergency contact — required at hire so "at least one at all times" holds from day
      // one. Plain create() works: the employee row now exists, so the RLS RETURNING recheck
      // passes. First contact is always primary.
      await tx.emergencyContact.create({
        data: {
          employeeId,
          name: input.emergencyContactName,
          relationship: input.emergencyContactRelationship,
          phone: input.emergencyContactPhone,
          isPrimary: true,
        },
      });
      return { employeeId, userId: user.id };
    });
  } catch (e) {
    const msg = /unique/i.test(e.message ?? "") ? "That email is already in use." : e.message ?? "Could not create employee.";
    return { error: msg };
  }

  // Email the invite AFTER the transaction commits — sending mail is a non-transactional
  // side effect, and a mail failure must not roll back (or block) the created record. If it
  // fails, the employee still exists and HR can resend from the profile.
  try {
    await sendInvite(newId.userId);
  } catch {
    // swallow — creation succeeded; resend covers the mail failure.
  }

  revalidatePath("/employees");
  redirect(`/employees/${newId.employeeId}`);
}

// Resend (or first-send) a new hire's invite email. HR-gated. Regenerating the token
// invalidates any earlier link. Returns { ok } / { skipped } / { error } for the button.
export async function resendInvite(userId) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return { error: "You are not authorized." };
  try {
    const result = await sendInvite(userId);
    if (result.skipped) return { error: "This account is already active." };
    return { ok: true };
  } catch {
    return { error: "Could not send the invite email." };
  }
}

// Read-only action powering the audit page's "Load more". All authorization lives in the
// query (RLS scopes the rows, comp redaction scrubs the payloads) — the client only holds
// an opaque cursor, and nothing it sends is trusted.
export async function loadMoreAuditLog(employeeId, cursor) {
  const result = await getEmployeeAuditLog(employeeId, cursor);
  if (!result) return { error: "Not available." };
  return { events: result.events, nextCursor: result.nextCursor };
}
