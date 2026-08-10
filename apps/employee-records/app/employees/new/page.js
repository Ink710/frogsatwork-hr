import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewEmployeeFormData, getHireForPrefill } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { CreateEmployeeForm } from "@/components/CreateEmployeeForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("create.title")} · FrogsAtWorkHR` };
}

// Reached either directly ("New employee") or from the onboarding queue with ?fromApplication=<id>,
// in which case the form is prefilled with what the ATS actually knows about the candidate. Only
// name/email/phone carry over — department, title, employment type, salary and emergency contact are
// HR's to enter. Nothing about the employment relationship is invented from recruiting data.
export default async function NewEmployeePage({ searchParams }) {
  const sp = await searchParams; // async in Next 16
  const data = await getNewEmployeeFormData();
  if (!data) notFound(); // not authorized (or no session)
  const t = await getT();

  // Null when the id is stale, already onboarded, or hidden by RLS — so a guessed link reveals nothing.
  const hire = sp?.fromApplication ? await getHireForPrefill(sp.fromApplication) : null;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/employees" className="text-sm text-muted-foreground hover:text-foreground">
        {t("profile.allEmployees")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("create.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("create.subtitle")}</p>

      {hire && (
        <p className="mt-4 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
          {t("create.fromApplication", { name: `${hire.firstName} ${hire.lastName}`, job: hire.jobTitle })}
        </p>
      )}

      <CreateEmployeeForm {...data} hire={hire} />
    </main>
  );
}
