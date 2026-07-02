import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canEditEmployee } from "@hris/auth";
import { getEmployeeProfile } from "@/lib/queries";
import { humanize, formatDate } from "@/lib/format";
import { HistoryTimeline } from "@/components/HistoryTimeline";

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
          {canEdit && (
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
        </div>
      </header>

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

      {/* Emergency contacts */}
      {e.emergencyContacts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Emergency contacts
          </h2>
          <ul className="space-y-2">
            {e.emergencyContacts.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-medium">{c.name}</span>{" "}
                <span className="text-zinc-500">({c.relationship})</span> · {c.phone}
                {c.isPrimary && (
                  <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    Primary
                  </span>
                )}
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
