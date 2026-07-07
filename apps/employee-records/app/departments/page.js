import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canManageDepartments } from "@hris/auth";
import { getDepartments } from "@/lib/queries";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Departments · PeopleBase" };

export default async function DepartmentsPage() {
  const departments = await getDepartments();
  if (!departments) notFound(); // employees / unauthenticated don't get this feature

  const viewer = await getViewer();
  const canManage = viewer ? canManageDepartments(viewer) : false;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
          <p className="text-sm text-zinc-500">
            {departments.length} department{departments.length === 1 ? "" : "s"}
          </p>
        </div>
        {canManage && (
          <Link
            href="/departments/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            New department
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => (
          <Link
            key={d.id}
            href={`/departments/${d.id}`}
            className="rounded-xl border border-zinc-200 p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <h2 className="text-base font-medium">{d.name}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Employees</dt>
                <dd className="font-medium tabular-nums">{d.employeeCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Head</dt>
                <dd>{d.headName ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Budget</dt>
                <dd>
                  {d.budgetHidden ? (
                    <span className="text-zinc-400">Restricted</span>
                  ) : (
                    <span className="font-medium">{formatMoney(d.budget) ?? "—"}</span>
                  )}
                </dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </main>
  );
}
