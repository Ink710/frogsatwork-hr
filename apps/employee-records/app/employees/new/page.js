import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewEmployeeFormData } from "@/lib/queries";
import { CreateEmployeeForm } from "@/components/CreateEmployeeForm";

export const metadata = { title: "New employee · PeopleBase" };

export default async function NewEmployeePage() {
  const data = await getNewEmployeeFormData();
  if (!data) notFound(); // not authorized (or no session)

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/employees" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← All employees
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New employee</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Creates the record, its first history version, and a login identity.
      </p>
      <CreateEmployeeForm {...data} />
    </main>
  );
}
