import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartmentForEdit } from "@/lib/queries";
import { DepartmentForm } from "@/components/DepartmentForm";

export const metadata = { title: "Edit department · PeopleBase" };

export default async function EditDepartmentPage({ params }) {
  const { id } = await params;
  const data = await getDepartmentForEdit(id);
  if (!data) notFound(); // non-HR_ADMIN or missing department

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href={`/departments/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to department
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Edit {data.department.name}</h1>
      <DepartmentForm
        department={data.department}
        parentOptions={data.parentOptions}
        headOptions={data.headOptions}
      />
    </main>
  );
}
