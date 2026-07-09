import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForLifecycle } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { RehireForm } from "@/components/RehireForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("profile.rehire")} · PeopleBase` };
}

export default async function RehirePage({ params }) {
  const { id } = await params;
  const employee = await getEmployeeForLifecycle(id);
  // Only a terminated, rehire-eligible employee can reach this.
  if (!employee || employee.employmentStatus !== "TERMINATED" || !employee.eligibleForRehire) {
    notFound();
  }
  const t = await getT();
  const name = `${employee.firstName} ${employee.lastName}`;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        {t("common.backToProfile")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("rehire.title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("rehire.subtitle", { name })}</p>
      <RehireForm employeeId={id} />
    </main>
  );
}
