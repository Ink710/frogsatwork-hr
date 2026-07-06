import Link from "next/link";
import { getViewer, canEditEmployee } from "@hris/auth";
import { getEmployees } from "@/lib/queries";
import { humanize } from "@/lib/format";

export const metadata = {
  title: "Employees · PeopleBase",
};

const STATUS_STYLES = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ON_LEAVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUSPENDED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  TERMINATED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

// Async Server Component: it awaits the DB query on the server and streams HTML.
// No useEffect, no client-side fetch, no loading spinner in the component itself —
// the awaited data is already here by the time this renders.
export default async function EmployeesPage() {
  const employees = await getEmployees();
  const viewer = await getViewer();
  const canCreate = viewer ? canEditEmployee(viewer) : false;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-zinc-500">
            {employees.length} {employees.length === 1 ? "person" : "people"}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/employees/new"
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
          >
            New employee
          </Link>
        )}
      </header>

      {employees.length === 0 ? (
        // Empty state — explicit, not a blank table.
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500">
            No employees yet. Run <code className="font-mono">pnpm --filter @hris/database db:seed</code>.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{e.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/employees/${e.id}`} className="hover:underline">
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{e.title}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{e.department}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{e.manager}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{humanize(e.employmentType)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[e.status] ?? STATUS_STYLES.TERMINATED
                      }`}
                    >
                      {humanize(e.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
