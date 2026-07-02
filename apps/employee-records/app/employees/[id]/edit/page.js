import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForEdit } from "@/lib/queries";
import { EditChangeForm } from "@/components/EditChangeForm";

export const metadata = { title: "Record a change · PeopleBase" };

export default async function EditPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeForEdit(id);
  // null = not found OR not authorized to edit — either way, 404 (don't reveal which).
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Record a change
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {data.employee.firstName} {data.employee.lastName} — this creates a new dated
        version; it doesn’t overwrite history.
      </p>
      <EditChangeForm employeeId={id} {...data} />
    </main>
  );
}
