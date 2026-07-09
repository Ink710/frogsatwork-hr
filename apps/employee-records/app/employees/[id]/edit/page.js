import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForEdit } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { EditChangeForm } from "@/components/EditChangeForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("edit.title")} · PeopleBase` };
}

export default async function EditPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeForEdit(id);
  // null = not found OR not authorized to edit — either way, 404 (don't reveal which).
  if (!data) notFound();
  const t = await getT();
  const name = `${data.employee.firstName} ${data.employee.lastName}`;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        {t("common.backToProfile")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("edit.title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("edit.subtitle", { name })}</p>
      <EditChangeForm employeeId={id} {...data} />
    </main>
  );
}
