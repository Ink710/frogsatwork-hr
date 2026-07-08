import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canEditEmployee, canTerminate } from "@hris/auth";
import { getEmployeeOverview } from "@/lib/queries";
import { humanize, formatDate, formatMoney, formatPayBasis } from "@/lib/format";
import { Card, Field, FieldGrid, Pill } from "@/components/profile-ui";
import { EmergencyContacts } from "@/components/EmergencyContacts";
import { ResendInviteButton } from "@/components/ResendInviteButton";

const actionBtn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export default async function EmployeeOverviewPage({ params }) {
  const { id } = await params;
  const e = await getEmployeeOverview(id);
  if (!e) notFound();

  const viewer = await getViewer();
  const canEdit = viewer ? canEditEmployee(viewer) : false;
  const canLifecycle = viewer ? canTerminate(viewer) : false;
  const isTerminated = e.employmentStatus === "TERMINATED";
  const isActive = e.employmentStatus === "ACTIVE";
  const onLeaveOrSuspended =
    e.employmentStatus === "ON_LEAVE" || e.employmentStatus === "SUSPENDED";
  // Emergency contacts: writable by HR or the employee themselves, never managers.
  const canManageContacts = canEdit || viewer?.employeeId === e.id;

  const c = e.current; // current version's employment facts (may be null in edge cases)
  const salaryLabel =
    e.comp?.salary != null
      ? `${formatMoney(e.comp.salary, e.comp.currency)}${formatPayBasis(e.comp.payBasis)}`
      : null;

  return (
    <div className="space-y-6">
      {/* Actions — available from the Overview (the profile landing tab). */}
      {(canEdit || canLifecycle) && !isTerminated && (
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && (
            <>
              <Link href={`/employees/${e.id}/edit`} className={actionBtn}>Record change</Link>
              <Link href={`/employees/${e.id}/correct`} className={actionBtn}>Correct data</Link>
            </>
          )}
          {canLifecycle && isActive && (
            <>
              <Link href={`/employees/${e.id}/status?type=LEAVE`} className={actionBtn}>Place on leave</Link>
              <Link href={`/employees/${e.id}/status?type=SUSPENSION`} className={actionBtn}>Suspend</Link>
            </>
          )}
          {canLifecycle && onLeaveOrSuspended && (
            <Link href={`/employees/${e.id}/reinstate`} className={actionBtn}>Return to active</Link>
          )}
          {canLifecycle && (
            <Link
              href={`/employees/${e.id}/terminate`}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Terminate
            </Link>
          )}
        </div>
      )}
      {canLifecycle && isTerminated && e.eligibleForRehire && (
        <div className="flex justify-end">
          <Link
            href={`/employees/${e.id}/rehire`}
            className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900/60 dark:text-green-400 dark:hover:bg-green-950/30"
          >
            Rehire
          </Link>
        </div>
      )}

      {/* Account activation prompt (HR only, until the new hire sets a password). */}
      {canEdit && !isTerminated && e.user && !e.user.emailVerifiedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <div>
            <span className="font-medium text-amber-800 dark:text-amber-300">Invite pending</span>
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              {e.user.invitedAt
                ? "This employee hasn't set a password yet."
                : "No invite has been sent yet."}
            </span>
          </div>
          <ResendInviteButton userId={e.userId} label={e.user.invitedAt ? "Resend invite" : "Send invite"} />
        </div>
      )}

      {/* Current leave/suspension notice (reason/actor already redacted for a subject's own suspension). */}
      {e.currentStatusChange && (
        <div
          className={`rounded-md border p-4 text-sm ${
            e.currentStatusChange.type === "SUSPENSION"
              ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
              : "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          }`}
        >
          <span className="font-medium">
            {e.currentStatusChange.type === "SUSPENSION" ? "Suspended" : "On leave"}
          </span>
          {" since "}
          {formatDate(e.currentStatusChange.startDate)}
          {e.currentStatusChange.expectedEnd && (
            <> · expected return {formatDate(e.currentStatusChange.expectedEnd)}</>
          )}
          {e.currentStatusChange.reason && <> — {e.currentStatusChange.reason}</>}
          {e.currentStatusChange.createdBy && (
            <span className="ml-2 text-zinc-500">by {e.currentStatusChange.createdBy.name}</span>
          )}
        </div>
      )}

      {isTerminated && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="font-medium">Terminated</span>
          {e.terminationDate && <> on {formatDate(e.terminationDate)}</>}
          {e.terminationReason && <> — {e.terminationReason}</>}
          <span className="ml-2 text-zinc-500">
            ({e.eligibleForRehire ? "eligible for rehire" : "not eligible for rehire"})
          </span>
        </div>
      )}

      {/* Employment details — ungated. */}
      <Card title="Employment details">
        <FieldGrid>
          <Field label="Job title">{c?.jobTitle}</Field>
          <Field label="Employment type">{humanize(c?.employmentType)}</Field>
          <Field label="FLSA classification">{humanize(c?.flsaClassification)}</Field>
          <Field label="Pay frequency">{humanize(c?.payFrequency)}</Field>
          <Field label="Work schedule">{e.workSchedule}</Field>
          <Field label="Time zone">{e.timeZone}</Field>
        </FieldGrid>
      </Card>

      {/* Compensation — gated by the comp guard (self + subtree + HR/payroll per the matrix). */}
      <Card
        title="Compensation"
        action={e.canViewComp ? <Pill>HR / Payroll only</Pill> : null}
      >
        {e.canViewComp ? (
          <FieldGrid>
            <Field label="Base salary">{salaryLabel}</Field>
            <Field label="Last review">{formatDate(e.comp.lastReviewDate)}</Field>
            <Field label="Next review">{formatDate(e.comp.nextReviewDate)}</Field>
            <Field label="Equity vesting">{e.comp.equityNote}</Field>
          </FieldGrid>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Compensation is hidden for your role.
          </p>
        )}
      </Card>

      {/* Emergency contact — editable by HR or the employee themselves. */}
      <Card title="Emergency contact">
        <EmergencyContacts
          contacts={e.emergencyContacts}
          employeeId={e.id}
          canManage={canManageContacts}
          embedded
        />
      </Card>

      {/* Direct reports — click to walk the org tree. */}
      {e.reports.length > 0 && (
        <Card title={`Direct reports (${e.reports.length})`}>
          <ul className="flex flex-wrap gap-2">
            {e.reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/employees/${r.id}`}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  {r.firstName} {r.lastName}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Leave & suspension history (subject sees only their own past leaves). */}
      {e.statusHistory.length > 0 && (
        <Card title="Leave & suspension history">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {e.statusHistory.map((s) => (
              <li key={s.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                <span className="font-medium">{s.type === "SUSPENSION" ? "Suspension" : "Leave"}</span>
                <span className="ml-2 text-zinc-500">
                  {formatDate(s.startDate)} — {formatDate(s.endDate)}
                </span>
                {s.reason && <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{s.reason}</div>}
                {s.createdBy && <span className="text-xs text-zinc-400">by {s.createdBy.name}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
