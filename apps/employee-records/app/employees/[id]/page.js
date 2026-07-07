import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canEditEmployee, canTerminate } from "@hris/auth";
import { getEmployeeProfile } from "@/lib/queries";
import { getEmployeeDocuments } from "@/lib/documents";
import { humanize, formatDate } from "@/lib/format";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { UploadDocForm } from "@/components/UploadDocForm";
import { DeleteDocButton } from "@/components/DeleteDocButton";
import { ResendInviteButton } from "@/components/ResendInviteButton";
import { EmergencyContacts } from "@/components/EmergencyContacts";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_STYLES = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ON_LEAVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUSPENDED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  TERMINATED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

// In Next 16 route `params` is async — you must await it before reading `id`.
export async function generateMetadata({ params }) {
  const { id } = await params;
  const e = await getEmployeeProfile(id); // deduped with the page via cache()
  return {
    title: e ? `${e.firstName} ${e.lastName} · PeopleBase` : "Employee · PeopleBase",
  };
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default async function EmployeeProfilePage({ params }) {
  const { id } = await params;
  const e = await getEmployeeProfile(id);

  // No matching employee → render the 404 boundary instead of crashing.
  if (!e) notFound();

  const viewer = await getViewer();
  const canEdit = viewer ? canEditEmployee(viewer) : false;
  const canLifecycle = viewer ? canTerminate(viewer) : false;
  const isTerminated = e.employmentStatus === "TERMINATED";
  const isActive = e.employmentStatus === "ACTIVE";
  const onLeaveOrSuspended = e.employmentStatus === "ON_LEAVE" || e.employmentStatus === "SUSPENDED";
  // Emergency contacts are writable by HR or the employee themselves — never managers (RLS would
  // allow a manager, so this app-layer check is what actually blocks them).
  const canManageContacts = (viewer && canEditEmployee(viewer)) || viewer?.employeeId === e.id;
  const documents = await getEmployeeDocuments(e.id);

  // The current version is the open history row; fall back to newest if needed.
  const current = e.history.find((h) => h.effectiveTo === null) ?? e.history[0];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/employees" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← All employees
      </Link>

      {/* Header */}
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {e.firstName} {e.lastName}
          </h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">
            {current?.jobTitle ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
              STATUS_STYLES[e.employmentStatus] ?? STATUS_STYLES.TERMINATED
            }`}
          >
            {humanize(e.employmentStatus)}
          </span>
          <Link
            href={`/employees/${e.id}/audit`}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Audit log
          </Link>
          {canEdit && !isTerminated && (
            <>
              <Link
                href={`/employees/${e.id}/edit`}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Record change
              </Link>
              <Link
                href={`/employees/${e.id}/correct`}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Correct data
              </Link>
            </>
          )}
          {canLifecycle && isActive && (
            <>
              <Link
                href={`/employees/${e.id}/status?type=LEAVE`}
                className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                Place on leave
              </Link>
              <Link
                href={`/employees/${e.id}/status?type=SUSPENSION`}
                className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                Suspend
              </Link>
            </>
          )}
          {canLifecycle && onLeaveOrSuspended && (
            <Link
              href={`/employees/${e.id}/reinstate`}
              className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900/60 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              Return to active
            </Link>
          )}
          {canLifecycle && !isTerminated && (
            <Link
              href={`/employees/${e.id}/terminate`}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Terminate
            </Link>
          )}
          {canLifecycle && isTerminated && e.eligibleForRehire && (
            <Link
              href={`/employees/${e.id}/rehire`}
              className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900/60 dark:text-green-400 dark:hover:bg-green-950/30"
            >
              Rehire
            </Link>
          )}
        </div>
      </header>

      {/* Account activation: HR sees an invite prompt until the new hire sets a password. */}
      {canEdit && !isTerminated && e.user && !e.user.emailVerifiedAt && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <div>
            <span className="font-medium text-amber-800 dark:text-amber-300">Invite pending</span>
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              {e.user.invitedAt
                ? "This employee hasn't set a password yet."
                : "No invite has been sent yet."}
            </span>
          </div>
          <ResendInviteButton
            userId={e.userId}
            label={e.user.invitedAt ? "Resend invite" : "Send invite"}
          />
        </div>
      )}

      {/* Current leave/suspension notice. Reason/actor are already redacted server-side when
          the viewer is the subject of a suspension (they see the notice, not the file). */}
      {e.currentStatusChange && (
        <div
          className={`mt-4 rounded-md border p-4 text-sm ${
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
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="font-medium">Terminated</span>
          {e.terminationDate && <> on {formatDate(e.terminationDate)}</>}
          {e.terminationReason && <> — {e.terminationReason}</>}
          <span className="ml-2 text-zinc-500">
            ({e.eligibleForRehire ? "eligible for rehire" : "not eligible for rehire"})
          </span>
        </div>
      )}

      {/* Snapshot facts */}
      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800 sm:grid-cols-3">
        <Field label="Employee #">
          <span className="font-mono text-xs">{e.employeeNumber}</span>
        </Field>
        <Field label="Department">{e.department?.name ?? "—"}</Field>
        <Field label="Manager">
          {e.manager ? (
            <Link href={`/employees/${e.manager.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
              {e.manager.firstName} {e.manager.lastName}
            </Link>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Email">{e.email}</Field>
        <Field label="Hire date">{formatDate(e.hireDate)}</Field>
        <Field label="Type">{humanize(current?.employmentType)}</Field>
      </dl>

      {/* Direct reports — lets you walk the org tree by clicking. */}
      {e.reports.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Direct reports ({e.reports.length})
          </h2>
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
        </section>
      )}

      {/* Emergency contacts — editable by HR or the employee themselves (not managers). */}
      <EmergencyContacts
        contacts={e.emergencyContacts}
        employeeId={e.id}
        canManage={canManageContacts}
      />

      {/* Documents — RLS-scoped list; upload/delete for HR only. */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Documents ({documents.length})
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-zinc-400">No documents.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <a href={d.downloadUrl} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    {d.fileName}
                  </a>
                  <span className="ml-2 text-xs text-zinc-400">
                    {humanize(d.documentType)} · {formatBytes(d.fileSizeBytes)} · {formatDate(d.createdAt)} · {d.uploadedByName}
                    {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}
                  </span>
                </div>
                {canEdit && <DeleteDocButton docId={d.id} />}
              </li>
            ))}
          </ul>
        )}
        {canEdit && <UploadDocForm employeeId={e.id} />}
      </section>

      {/* Leave & suspension history — past occurrences, retained forever. Suspensions are
          filtered out server-side when the viewer is the subject. */}
      {e.statusHistory.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Leave &amp; suspension history
          </h2>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {e.statusHistory.map((s) => (
              <li key={s.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium">{s.type === "SUSPENSION" ? "Suspension" : "Leave"}</span>
                <span className="ml-2 text-zinc-500">
                  {formatDate(s.startDate)} — {formatDate(s.endDate)}
                </span>
                {s.reason && <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{s.reason}</div>}
                {s.createdBy && <span className="text-xs text-zinc-400">by {s.createdBy.name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The signature feature: the effective-dated timeline. */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            History
          </h2>
          {!e.canViewComp && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
              Compensation hidden for your role
            </span>
          )}
        </div>
        <HistoryTimeline history={e.history} />
      </section>
    </main>
  );
}
