import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewEmployeeFormData } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { CreateEmployeeForm } from "@/components/CreateEmployeeForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("create.title")} · FrogsAtWorkHR` };
}

export default async function NewEmployeePage() {
  const data = await getNewEmployeeFormData();
  if (!data) notFound(); // not authorized (or no session)
  const t = await getT();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/employees" className="text-sm text-muted-foreground hover:text-foreground">
        {t("profile.allEmployees")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("create.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("create.subtitle")}</p>
      <CreateEmployeeForm {...data} />
    </main>
  );
}
