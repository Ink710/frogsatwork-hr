import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForLifecycle } from "@/lib/queries";
import { TerminateForm } from "@/components/TerminateForm";

export const metadata = { title: "Terminate · PeopleBase" };

export default async function TerminatePage({ params }) {
  const { id } = await params;
  const employee = await getEmployeeForLifecycle(id);
  if (!employee || employee.employmentStatus === "TERMINATED") notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Terminate employee</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {employee.firstName} {employee.lastName} — this is a soft delete: the record is
        retained, the current version is closed, and the action is audited.
      </p>
      <TerminateForm employeeId={id} />
    </main>
  );
}
