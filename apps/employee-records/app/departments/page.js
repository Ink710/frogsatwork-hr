import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canManageDepartments } from "@hris/auth";
import { getDepartments } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("dept.title")} · PeopleBase` };
}

export default async function DepartmentsPage() {
  const departments = await getDepartments();
  if (!departments) notFound(); // employees / unauthenticated don't get this feature

  const [viewer, t, localeCode] = await Promise.all([getViewer(), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];
  const canManage = viewer ? canManageDepartments(viewer) : false;
  const n = departments.length;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dept.title")}</h1>
          <p className="text-sm text-zinc-500">{t(n === 1 ? "dept.deptOne" : "dept.deptMany", { n })}</p>
        </div>
        {canManage && (
          <Link
            href="/departments/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {t("dept.new")}
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
                <dt className="text-zinc-500">{t("dept.employees")}</dt>
                <dd className="font-medium tabular-nums">{d.employeeCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">{t("dept.colHead")}</dt>
                <dd>{d.headName ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">{t("dept.colBudget")}</dt>
                <dd>
                  {d.budgetHidden ? (
                    <span className="text-zinc-400">{t("dept.budgetRestricted")}</span>
                  ) : (
                    <span className="font-medium">{formatMoney(d.budget, "USD", locale) ?? "—"}</span>
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
