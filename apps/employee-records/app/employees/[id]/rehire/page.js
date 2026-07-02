import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForLifecycle } from "@/lib/queries";
import { RehireForm } from "@/components/RehireForm";

export const metadata = { title: "Rehire · PeopleBase" };

export default async function RehirePage({ params }) {
  const { id } = await params;
  const employee = await getEmployeeForLifecycle(id);
  // Only a terminated, rehire-eligible employee can reach this.
  if (!employee || employee.employmentStatus !== "TERMINATED" || !employee.eligibleForRehire) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Rehire employee</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {employee.firstName} {employee.lastName} — reactivates the record with a fresh
        effective-dated version.
      </p>
      <RehireForm employeeId={id} />
    </main>
  );
}
