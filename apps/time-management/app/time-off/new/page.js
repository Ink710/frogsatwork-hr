import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getTimeOffOverview, getEmployeesForFiling } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { TimeOffRequestForm } from "@/components/TimeOffRequestForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("timeOff.new.title")} · FrogsAtWorkHR` };
}

export default async function NewTimeOffPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [overview, employees, t] = await Promise.all([
    getTimeOffOverview(),
    getEmployeesForFiling(), // [] unless the viewer is HR
    getT(),
  ]);

  // Available hours per type — passed to the client form for the live overdraw warning.
  const available = {};
  for (const b of overview?.balances ?? []) available[b.type] = b.available;

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <Link href="/time-off" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("timeOff.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("timeOff.new.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("timeOff.new.subtitle")}</p>

      <div className="mt-6">
        <TimeOffRequestForm available={available} employees={employees} />
      </div>
    </main>
  );
}
