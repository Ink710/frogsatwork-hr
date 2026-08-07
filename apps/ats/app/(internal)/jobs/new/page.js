import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { JOB_EMPLOYMENT_TYPES } from "@hris/recruiting";
import { Card } from "@hris/ui/server";
import { getT } from "@/lib/i18n.server";
import { canCreateJob, getJobFormData } from "@/lib/queries";
import { JobForm } from "@/components/JobForm";

// Open a new requisition. Gated to recruiters/HR — a brand-new job has no hiring team yet, so this
// is an app-layer decision (the `job_insert` RLS policy enforces the same rule at the database).
export default async function NewJobPage() {
  const t = await getT();
  const viewer = await getViewer();
  if (!canCreateJob(viewer)) notFound();

  const { departments } = await getJobFormData();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        {t("board.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("jobs.newTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("jobs.newSubtitle")}</p>

      <div className="mt-6">
        <Card title={t("jobForm.details")}>
          <JobForm departments={departments} employmentTypes={JOB_EMPLOYMENT_TYPES} />
        </Card>
      </div>
    </main>
  );
}
