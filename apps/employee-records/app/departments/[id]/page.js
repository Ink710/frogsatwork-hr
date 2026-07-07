import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canManageDepartments } from "@hris/auth";
import { getDepartmentDetail } from "@/lib/queries";
import { formatMoney, humanize } from "@/lib/format";
import { OrgNode } from "@/components/OrgNode";
import { DeleteDepartmentButton } from "@/components/DeleteDepartmentButton";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getDepartmentDetail(id);
  return { title: data ? `${data.department.name} · PeopleBase` : "Department · PeopleBase" };
}

function Stat({ label, value, href }) {
  const inner = <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>;
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      {href ? (
        <Link href={href} className="text-blue-600 hover:underline dark:text-blue-400">{inner}</Link>
      ) : (
        inner
      )}
    </div>
  );
}

export default async function DepartmentDetailPage({ params }) {
  const { id } = await params;
  const data = await getDepartmentDetail(id);
  if (!data) notFound();
  const { department, head, headcount, byType, employees, tree } = data;

  const viewer = await getViewer();
  const canManage = viewer ? canManageDepartments(viewer) : false;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link href="/departments" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← All departments
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{department.name}</h1>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              href={`/departments/${department.id}/edit`}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Edit
            </Link>
            <DeleteDepartmentButton departmentId={department.id} />
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Headcount" value={headcount} />
        <Stat
          label="Head"
          value={head?.name ?? "—"}
          href={head?.employeeId ? `/employees/${head.employeeId}` : null}
        />
        <Stat label="Budget" value={department.budgetHidden ? "Restricted" : formatMoney(department.budget) ?? "—"} />
      </div>

      {/* Stacks on mobile, two columns on desktop */}
      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.4fr]">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Employees ({employees.length})
          </h2>
          {employees.length === 0 ? (
            <p className="text-sm text-zinc-400">None visible to you.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {employees.map((e) => (
                <li key={e.id}>
                  <Link href={`/employees/${e.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-zinc-500">{e.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {byType.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {byType.map((t) => (
                <span key={t.label} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {humanize(t.label)}: {t.count}
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Reporting structure
          </h2>
          {tree.length === 0 ? (
            <p className="text-sm text-zinc-400">No hierarchy to show.</p>
          ) : (
            <div className="overflow-x-auto pb-4">
              <ul className="orgtree inline-flex justify-center">
                {tree.map((root) => (
                  <OrgNode key={root.id} node={root} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
