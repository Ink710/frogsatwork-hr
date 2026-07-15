import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canManageDepartments } from "@hris/auth";
import { getDepartmentDetail } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { OrgNode } from "@/components/OrgNode";
import { DeleteDepartmentButton } from "@/components/DeleteDepartmentButton";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const data = await getDepartmentDetail(id);
  return { title: data ? `${data.department.name} · FrogsAtWorkHR` : "Department · FrogsAtWorkHR" };
}

function Stat({ label, value, href }) {
  const inner = <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>;
  return (
    <div className="rounded-xl border border-border p-5 ">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {href ? (
        <Link href={href} className="text-primary hover:underline ">{inner}</Link>
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

  const [viewer, t, localeCode] = await Promise.all([getViewer(), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];
  const canManage = viewer ? canManageDepartments(viewer) : false;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link href="/departments" className="text-sm text-muted-foreground hover:text-foreground">
        {t("dept.backToDepartments")}
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{department.name}</h1>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              href={`/departments/${department.id}/edit`}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted  "
            >
              {t("dept.edit")}
            </Link>
            <DeleteDepartmentButton departmentId={department.id} />
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label={t("dept.headcount")} value={headcount} />
        <Stat
          label={t("dept.colHead")}
          value={head?.name ?? "—"}
          href={head?.employeeId ? `/employees/${head.employeeId}` : null}
        />
        <Stat label={t("dept.colBudget")} value={department.budgetHidden ? t("dept.budgetRestricted") : formatMoney(department.budget, "USD", locale) ?? "—"} />
      </div>

      {/* Stacks on mobile, two columns on desktop */}
      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.4fr]">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dept.employeesCount", { count: employees.length })}
          </h2>
          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dept.noneVisible")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border  ">
              {employees.map((e) => (
                <li key={e.id}>
                  <Link href={`/employees/${e.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground">{e.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {byType.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {byType.map((bt) => (
                <span key={bt.label} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground  dark:text-muted-foreground/50">
                  {t(`enum.employmentType.${bt.label}`)}: {bt.count}
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dept.reportingStructure")}
          </h2>
          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dept.noHierarchy")}</p>
          ) : (
            <div className="overflow-x-auto pb-4">
              <ul className="orgtree inline-flex justify-center">
                {tree.map((root) => (
                  <OrgNode key={root.id} node={root} t={t} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
