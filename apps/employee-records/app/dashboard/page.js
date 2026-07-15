import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Building2, UserPlus, UserMinus, PieChart } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getDashboardStats, getDepartmentBudgets } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { BudgetPie } from "@/components/BudgetPie";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("dash.title")} · FrogsAtWorkHR` };
}

function StatCard({ label, value, hint, href, icon: Icon }) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />}
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-card p-5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-ring`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Charts use the brand categorical palette (green / aqua / navy / yellow) — one hue per chart.
function Bars({ title, data, emptyText, barClass = "bg-primary", format = (x) => x }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate text-muted-foreground">{format(d.label)}</span>
              <span className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                <span
                  className={`absolute inset-y-0 left-0 rounded ${barClass}`}
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
  // The dashboard isn't part of an employee's world (own profile + org chart only).
  const me = await getViewer();
  if (me?.role === "EMPLOYEE" && me.employeeId) {
    redirect(`/employees/${me.employeeId}`);
  }

  const s = await getDashboardStats();
  if (!s) return null;
  const t = await getT();
  const noData = t("dash.noData");
  // Budget pie: null unless the viewer is upper management (HR_ADMIN / PAYROLL_ADMIN).
  const [localeCode, budgets] = await Promise.all([getLocale(), getDepartmentBudgets()]);
  const locale = INTL_LOCALE[localeCode];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dash.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dash.subtitle")}</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t("dash.activeHeadcount")} value={s.activeHeadcount} icon={Users} />
        <StatCard label={t("dash.departments")} value={s.departmentCount} hint={t("dash.viewAll")} href="/departments" icon={Building2} />
        <StatCard label={t("dash.newHires")} value={s.newHires} hint={t("dash.thisYear")} icon={UserPlus} />
        <StatCard label={t("dash.terminations")} value={s.terminations} hint={t("dash.thisYear")} icon={UserMinus} />
      </div>

      {budgets && budgets.length > 0 && (
        <section className="mt-10 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <PieChart className="h-4 w-4" aria-hidden="true" />
            {t("dash.budgets")}
          </h2>
          <BudgetPie data={budgets} locale={locale} t={t} />
        </section>
      )}

      <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2">
        <Bars title={t("dash.byDepartment")} data={s.byDepartment} emptyText={noData} barClass="bg-primary" />
        <Bars title={t("dash.byType")} data={s.byType} emptyText={noData} barClass="bg-aqua" format={(v) => t(`enum.employmentType.${v}`)} />
        <Bars title={t("dash.byStatus")} data={s.byStatus} emptyText={noData} barClass="bg-info" format={(v) => t(`enum.status.${v}`)} />
        <Bars title={t("dash.spanOfControl")} data={s.spanOfControl} emptyText={noData} barClass="bg-yellow" />
      </div>
    </main>
  );
}
