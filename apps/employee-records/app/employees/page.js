import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, canEditEmployee } from "@hris/auth";
import { EMPLOYMENT_TYPES } from "@hris/types";
import { getEmployees, getDepartmentOptions } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("employees.title")} · PeopleBase` };
}

const STATUS_STYLES = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ON_LEAVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUSPENDED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  TERMINATED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};
const STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"];

const fieldCls = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default async function EmployeesPage({ searchParams }) {
  // Employees don't browse the roster — they land on (and are confined to) their own profile.
  // This is also where "log in → own profile" happens: login redirects here, and here we bounce
  // an employee to /employees/{their id}.
  const me = await getViewer();
  if (me?.role === "EMPLOYEE" && me.employeeId) {
    redirect(`/employees/${me.employeeId}`);
  }

  const sp = await searchParams; // async in Next 16
  const q = typeof sp?.q === "string" ? sp.q : "";
  const status = typeof sp?.status === "string" ? sp.status : "";
  const dept = typeof sp?.dept === "string" ? sp.dept : "";
  const type = typeof sp?.type === "string" ? sp.type : "";
  const page = Math.max(1, parseInt(sp?.page, 10) || 1);
  const hasFilters = Boolean(q || status || dept || type);

  const [result, departments, viewer, t] = await Promise.all([
    getEmployees({ q, status, departmentId: dept, employmentType: type, page }),
    getDepartmentOptions(),
    getViewer(),
    getT(),
  ]);
  const { rows, total, page: current, pageSize, pageCount } = result;
  const canCreate = viewer ? canEditEmployee(viewer) : false;

  const buildHref = (overrides) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (dept) params.set("dept", dept);
    if (type) params.set("type", type);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params.set(k, String(v));
      else params.delete(k);
    }
    const s = params.toString();
    return s ? `/employees?${s}` : "/employees";
  };

  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("employees.title")}</h1>
          <p className="text-sm text-zinc-500">
            {total} {total === 1 ? t("employees.personWord") : t("employees.peopleWord")}
            {total > 0 && <> {" · "}{t("employees.showing", { from, to })}</>}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/employees/new"
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
          >
            {t("employees.new")}
          </Link>
        )}
      </header>

      {/* Filter bar: a plain GET form, so the whole page stays a server component and every
          filter lands in the URL (shareable, back-button friendly). Omitting `page` resets to 1. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t("employees.searchPlaceholder")}
          className={`${fieldCls} min-w-56 flex-1`}
        />
        <select name="status" defaultValue={status} className={fieldCls} aria-label={t("employees.colStatus")}>
          <option value="">{t("employees.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`enum.status.${s}`)}</option>
          ))}
        </select>
        <select name="dept" defaultValue={dept} className={fieldCls} aria-label={t("employees.colDepartment")}>
          <option value="">{t("employees.allDepartments")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select name="type" defaultValue={type} className={fieldCls} aria-label={t("employees.colType")}>
          <option value="">{t("employees.allTypes")}</option>
          {EMPLOYMENT_TYPES.map((ty) => (
            <option key={ty} value={ty}>{t(`enum.employmentType.${ty}`)}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
          {t("employees.filter")}
        </button>
        {hasFilters && (
          <Link href="/employees" className="px-2 py-1.5 text-sm text-zinc-500 hover:underline">
            {t("common.clear")}
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          {hasFilters ? (
            <p className="text-sm text-zinc-500">
              {t("employees.emptyNoMatch")}{" "}
              <Link href="/employees" className="underline">{t("common.clear")}</Link>
            </p>
          ) : (
            <p className="text-sm text-zinc-500">
              {t("employees.emptySeed")}{" "}
              <code className="font-mono">pnpm --filter @hris/database db:seed</code>
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("employees.colNumber")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colName")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colTitle")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colDepartment")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colManager")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colType")}</th>
                  <th className="px-4 py-3 font-medium">{t("employees.colStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((e) => (
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
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{t(`enum.employmentType.${e.employmentType}`)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[e.status] ?? STATUS_STYLES.TERMINATED
                        }`}
                      >
                        {t(`enum.status.${e.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
              {current > 1 ? (
                <Link href={buildHref({ page: current - 1 })} className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
                  {t("employees.prev")}
                </Link>
              ) : (
                <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{t("employees.prev")}</span>
              )}

              <div className="flex items-center gap-1">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <Link
                    key={p}
                    href={buildHref({ page: p })}
                    aria-current={p === current ? "page" : undefined}
                    className={`rounded-md px-3 py-1.5 font-medium ${
                      p === current
                        ? "bg-foreground text-background"
                        : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {p}
                  </Link>
                ))}
              </div>

              {current < pageCount ? (
                <Link href={buildHref({ page: current + 1 })} className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
                  {t("employees.next")}
                </Link>
              ) : (
                <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{t("employees.next")}</span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
