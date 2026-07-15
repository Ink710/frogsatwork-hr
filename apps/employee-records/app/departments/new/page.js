import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewDepartmentFormData } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { DepartmentForm } from "@/components/DepartmentForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("dept.newTitle")} · FrogsAtWorkHR` };
}

export default async function NewDepartmentPage() {
  const data = await getNewDepartmentFormData();
  if (!data) notFound(); // non-HR_ADMIN
  const t = await getT();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href="/departments" className="text-sm text-muted-foreground hover:text-foreground">
        {t("dept.backToDepartments")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("dept.newTitle")}</h1>
      <DepartmentForm parentOptions={data.parentOptions} headOptions={data.headOptions} />
    </main>
  );
}
