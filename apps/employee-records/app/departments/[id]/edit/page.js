import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartmentForEdit } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { DepartmentForm } from "@/components/DepartmentForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("dept.edit")} · FrogsAtWorkHR` };
}

export default async function EditDepartmentPage({ params }) {
  const { id } = await params;
  const data = await getDepartmentForEdit(id);
  if (!data) notFound(); // non-HR_ADMIN or missing department
  const t = await getT();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href={`/departments/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("dept.backToDepartment")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("dept.editNamed", { name: data.department.name })}</h1>
      <DepartmentForm
        department={data.department}
        parentOptions={data.parentOptions}
        headOptions={data.headOptions}
      />
    </main>
  );
}
