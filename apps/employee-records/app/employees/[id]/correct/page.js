import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForCorrection } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { CorrectForms } from "@/components/CorrectForms";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("correct.title")} · FrogsAtWorkHR` };
}

export default async function CorrectPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeForCorrection(id);
  if (!data) notFound();
  const t = await getT();
  const name = `${data.employee.firstName} ${data.employee.lastName}`;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("common.backToProfile")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("correct.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("correct.subtitle", { name })}</p>
      <CorrectForms employeeId={id} {...data} />
    </main>
  );
}
