import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForCorrection } from "@/lib/queries";
import { CorrectForms } from "@/components/CorrectForms";

export const metadata = { title: "Correct data · PeopleBase" };

export default async function CorrectPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeForCorrection(id);
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Correct data</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {data.employee.firstName} {data.employee.lastName} — corrections fix mis-entered
        data. They don’t create a new version; every correction is audited.
      </p>
      <CorrectForms employeeId={id} {...data} />
    </main>
  );
}
