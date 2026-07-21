"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer, isHrRole, getSubtreeIds } from "@hris/auth";
import { leaveRequestSchema, decisionSchema, canApproveTimeOff } from "@hris/workable-hours";
import { runAccrualForOrg } from "@/lib/accrual";

// What every form action returns to useActionState: { error } on failure, or it never returns
// (redirects) on success. Mirrors the employee-records action shape.
function errorMessage(e) {
  return e instanceof Error ? e.message : undefined;
}

// Submit a time-off request. An employee files for themselves; HR may file on behalf of any
// employee (the `employeeId` field). Overdraw is NOT blocked here — per policy it's a warning
// surfaced in the UI + to the approver, not a hard stop.
export async function submitTimeOff(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };

  const parsed = leaveRequestSchema.safeParse({
    type: formData.get("type"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    hours: formData.get("hours"),
    reason: formData.get("reason") || undefined,
    employeeId: formData.get("employeeId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  // Authority: file for yourself, or — HR only — on behalf of another employee.
  let subjectId = viewer.employeeId;
  if (input.employeeId && input.employeeId !== viewer.employeeId) {
    if (!isHrRole(viewer.role)) return { error: "Only HR can file a request for another employee." };
    subjectId = input.employeeId;
  }
  if (!subjectId) return { error: "Your account has no employee record to request time off." };

  try {
    await withViewer(viewer, async (tx) => {
      // Confirm the subject is visible to the viewer under RLS (self, or all for HR). create()'s
      // RETURNING re-applies the SELECT policy — safe here because the subject already exists and
      // is visible (unlike the brand-new-employee insert in employee-records).
      const emp = await tx.employee.findUnique({ where: { id: subjectId }, select: { id: true } });
      if (!emp) throw new Error("That employee is not available to you.");

      const request = await tx.leaveRequest.create({
        data: {
          employeeId: subjectId,
          type: input.type,
          startDate: input.startDate,
          endDate: input.endDate,
          hours: input.hours.toFixed(2), // Decimal as a fixed-precision string, never a float
          reason: input.reason ?? null,
          status: "PENDING",
          createdById: viewer.userId,
        },
      });

      // The request row is the primary record; this audit row is the compliance trail. No balance
      // change yet — the USAGE ledger entry is written on approval (Phase C).
      await tx.employeeAuditLog.create({
        data: {
          employeeId: subjectId,
          eventType: "TIME_OFF_REQUEST",
          actorType: "USER",
          actorId: viewer.userId,
          afterState: {
            requestId: request.id,
            type: input.type,
            hours: input.hours,
            startDate: input.startDate.toISOString().slice(0, 10),
            endDate: input.endDate.toISOString().slice(0, 10),
            status: "PENDING",
          },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not submit the request." };
  }

  revalidatePath("/time-off");
  redirect("/time-off");
}

// Compute the viewer's approval authority over `subjectId` inside a withViewer tx. Managers need
// their subtree (a SECURITY DEFINER walk); HR doesn't. Returns true/false via the pure predicate.
async function viewerCanApprove(viewer, subjectId, tx) {
  const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
  return canApproveTimeOff(viewer, subjectId, { subtreeIds });
}

// Approve a pending request: mark it APPROVED, deduct the hours from the balance (a USAGE ledger
// row), and audit it — all in one transaction. Only a manager-of-subject or HR (never self).
export async function approveTimeOff(requestId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      // findUnique is RLS-scoped: a request the viewer can't see comes back null.
      const request = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error("Request not found.");
      if (request.status !== "PENDING") throw new Error("Only a pending request can be approved.");
      if (!(await viewerCanApprove(viewer, request.employeeId, tx))) {
        throw new Error("You are not authorized to approve this request.");
      }

      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      // USAGE ledger row: negative hours, linked to the request. This is what moves the balance.
      await tx.leaveLedgerEntry.create({
        data: {
          employeeId: request.employeeId,
          type: request.type,
          hours: (-Number(request.hours)).toFixed(2),
          source: "USAGE",
          note: request.reason ?? null,
          effectiveDate: request.startDate,
          leaveRequestId: request.id,
          createdById: viewer.userId,
        },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: request.employeeId,
          eventType: "TIME_OFF_APPROVE",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { requestId: request.id, status: "PENDING" },
          afterState: { requestId: request.id, status: "APPROVED", hours: Number(request.hours) },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not approve the request." };
  }

  revalidatePath("/time-off/approvals");
  revalidatePath("/time-off");
  redirect("/time-off/approvals");
}

// Deny a pending request: mark it DENIED + audit. No ledger change (nothing was ever deducted).
export async function denyTimeOff(requestId, _prevState, formData) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };
  const parsed = decisionSchema.safeParse({ decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withViewer(viewer, async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error("Request not found.");
      if (request.status !== "PENDING") throw new Error("Only a pending request can be denied.");
      if (!(await viewerCanApprove(viewer, request.employeeId, tx))) {
        throw new Error("You are not authorized to deny this request.");
      }

      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: "DENIED", reviewedById: viewer.userId, reviewedAt: new Date(), decisionNote: parsed.data.decisionNote ?? null },
      });
      await tx.employeeAuditLog.create({
        data: {
          employeeId: request.employeeId,
          eventType: "TIME_OFF_DENY",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { requestId: request.id, status: "PENDING" },
          afterState: { requestId: request.id, status: "DENIED" },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not deny the request." };
  }

  revalidatePath("/time-off/approvals");
  revalidatePath("/time-off");
  redirect("/time-off/approvals");
}

// The subject (or a manager/HR) cancels a request. PENDING → CANCELLED (nothing to undo). An already
// APPROVED request also writes a REVERSAL ledger row (+hours) to return the balance.
export async function cancelTimeOff(requestId, _prevState) {
  const viewer = await getViewer();
  if (!viewer) return { error: "You must be signed in." };

  try {
    await withViewer(viewer, async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error("Request not found.");
      if (request.status !== "PENDING" && request.status !== "APPROVED") {
        throw new Error("Only a pending or approved request can be cancelled.");
      }
      // Authority: the subject themselves, or someone who could have approved it (manager/HR).
      const isSubject = viewer.employeeId && viewer.employeeId === request.employeeId;
      if (!isSubject && !(await viewerCanApprove(viewer, request.employeeId, tx))) {
        throw new Error("You are not authorized to cancel this request.");
      }

      const wasApproved = request.status === "APPROVED";
      await tx.leaveRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
      if (wasApproved) {
        // Give the deducted hours back with a REVERSAL entry (positive).
        await tx.leaveLedgerEntry.create({
          data: {
            employeeId: request.employeeId,
            type: request.type,
            hours: Number(request.hours).toFixed(2),
            source: "REVERSAL",
            note: "Cancelled approved request",
            effectiveDate: new Date(),
            leaveRequestId: request.id,
            createdById: viewer.userId,
          },
        });
      }
      await tx.employeeAuditLog.create({
        data: {
          employeeId: request.employeeId,
          eventType: "TIME_OFF_CANCEL",
          actorType: "USER",
          actorId: viewer.userId,
          beforeState: { requestId: request.id, status: request.status },
          afterState: { requestId: request.id, status: "CANCELLED", reversed: wasApproved },
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not cancel the request." };
  }

  revalidatePath("/time-off");
  revalidatePath("/time-off/approvals");
  redirect("/time-off");
}

// Thin dispatcher for the approvals UI: one <form> with two submit buttons (name="intent") drives
// this via useActionState, so approve/deny errors surface in the same place. Delegates to the real,
// individually-tested actions above.
export async function decideTimeOff(requestId, prevState, formData) {
  return formData.get("intent") === "deny"
    ? denyTimeOff(requestId, prevState, formData)
    : approveTimeOff(requestId, prevState, formData);
}

// HR-admin trigger to run this month's accrual on demand (the local/dev stand-in for the Vercel
// Cron). The engine itself runs as SYSTEM; this only authorizes who may press the button.
export async function runAccrualNow(_prevState) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "HR_ADMIN") return { error: "Only HR admins can run accrual." };
  try {
    const result = await runAccrualForOrg(viewer.orgId);
    revalidatePath("/time-off/policies");
    revalidatePath("/time-off");
    return { ok: true, period: result.period, created: result.created };
  } catch (e) {
    return { error: errorMessage(e) ?? "Could not run accrual." };
  }
}
