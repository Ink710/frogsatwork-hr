import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForStatusChange } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { StatusChangeForm } from "@/components/StatusChangeForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("profile.placeOnLeave")} · PeopleBase` };
}

export default async function StatusChangePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  // Only leave/suspension are handled here; anything else falls back to leave.
  const type = sp?.type === "SUSPENSION" ? "SUSPENSION" : "LEAVE";

  const employee = await getEmployeeForStatusChange(id);
  // Only an active employee can start a leave/suspension (one open span at a time).
  if (!employee || employee.employmentStatus !== "ACTIVE") notFound();
  const t = await getT();
  const isSuspension = type === "SUSPENSION";
  const name = `${employee.firstName} ${employee.lastName}`;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        {t("common.backToProfile")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {isSuspension ? t("status.titleSuspend") : t("status.titleLeave")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">{t("status.pageSubtitle", { name })}</p>
      <StatusChangeForm employeeId={id} type={type} />
    </main>
  );
}
