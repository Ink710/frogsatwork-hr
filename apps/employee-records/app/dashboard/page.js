import Link from "next/link";
import { getDashboardStats } from "@/lib/queries";
import { humanize } from "@/lib/format";

export const metadata = { title: "Dashboard · PeopleBase" };

function StatCard({ label, value, hint, href }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-zinc-200 p-5 dark:border-zinc-800";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-zinc-400 dark:hover:border-zinc-600`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Bars({ title, data, format = (x) => x }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-zinc-400">No data.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate text-zinc-600 dark:text-zinc-300">{format(d.label)}</span>
              <span className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
                <span
                  className="absolute inset-y-0 left-0 rounded bg-zinc-800 dark:bg-zinc-300"
                  style={{ width: `${(d.count / max) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-medium tabular-nums">{d.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const s = await getDashboardStats();
  if (!s) return null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500">Headcount and composition — scoped to what you can see.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Active headcount" value={s.activeHeadcount} />
        <StatCard label="Departments" value={s.departmentCount} hint="view all →" href="/departments" />
        <StatCard label="New hires" value={s.newHires} hint="this year" />
        <StatCard label="Terminations" value={s.terminations} hint="this year" />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2">
        <Bars title="By department" data={s.byDepartment} />
        <Bars title="By employment type" data={s.byType} format={humanize} />
        <Bars title="By status" data={s.byStatus} format={humanize} />
        <Bars title="Span of control (top managers)" data={s.spanOfControl} />
      </div>
    </main>
  );
}
