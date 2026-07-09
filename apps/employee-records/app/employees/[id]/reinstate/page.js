import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForReinstate } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { ReinstateForm } from "@/components/ReinstateForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("reinstate.title")} · PeopleBase` };
}

export default async function ReinstatePage({ params }) {
  const { id } = await params;
  const employee = await getEmployeeForReinstate(id);
  const status = employee?.employmentStatus;
  if (!employee || (status !== "ON_LEAVE" && status !== "SUSPENDED")) notFound();

  const [t, localeCode] = await Promise.all([getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];
  const name = `${employee.firstName} ${employee.lastName}`;
  const statusLabel = t(`enum.status.${status}`).toLowerCase();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        {t("common.backToProfile")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("reinstate.title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {t("reinstate.currently", { name, status: statusLabel })}
        {employee.current ? <> {t("reinstate.since", { date: formatDate(employee.current.startDate, locale) })}</> : null}{" "}
        {t("reinstate.note")}
      </p>
      <ReinstateForm employeeId={id} />
    </main>
  );
}
