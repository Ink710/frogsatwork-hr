import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeAuditLog } from "@/lib/queries";
import { AuditLogList } from "@/components/AuditLogList";

// In Next 16 route `params` is async — you must await it before reading `id`.
export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getEmployeeAuditLog(id); // deduped with the page via cache()
  return {
    title: data ? `Audit log · ${data.employee.name} · PeopleBase` : "Audit log · PeopleBase",
  };
}

export default async function EmployeeAuditPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeAuditLog(id);

  // RLS hid the employee (or no session) → same 404 boundary as the profile.
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href={`/employees/${data.employee.id}`}
        className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← Back to profile
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">
            {data.employee.name} ·{" "}
            <span className="font-mono text-xs">{data.employee.employeeNumber}</span>
          </p>
        </div>
        {!data.canViewComp && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            Compensation hidden for your role
          </span>
        )}
      </header>

      <section className="mt-8">
        {data.events.length === 0 ? (
          <p className="text-sm text-zinc-400">No audit events recorded.</p>
        ) : (
          <AuditLogList
            employeeId={data.employee.id}
            initialEvents={data.events}
            initialCursor={data.nextCursor}
          />
        )}
      </section>
    </main>
  );
}
