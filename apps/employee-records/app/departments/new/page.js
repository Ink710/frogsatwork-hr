import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewDepartmentFormData } from "@/lib/queries";
import { DepartmentForm } from "@/components/DepartmentForm";

export const metadata = { title: "New department · PeopleBase" };

export default async function NewDepartmentPage() {
  const data = await getNewDepartmentFormData();
  if (!data) notFound(); // non-HR_ADMIN

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href="/departments" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← All departments
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New department</h1>
      <DepartmentForm parentOptions={data.parentOptions} headOptions={data.headOptions} />
    </main>
  );
}
