import Link from "next/link";
import { notFound } from "next/navigation";
import { JOB_STATUSES, JOB_MEMBER_ROLES, JOB_EMPLOYMENT_TYPES } from "@hris/recruiting";
import { Card } from "@hris/ui/server";
import { getT } from "@/lib/i18n.server";
import { getJobForManage, getJobFormData, getAssignableEmployees } from "@/lib/queries";
import { JobStatusBadge } from "@/components/recruiting-ui";
import { JobForm } from "@/components/JobForm";
import { RoundEditor } from "@/components/RoundEditor";
import { TeamEditor } from "@/components/TeamEditor";
import { JobStatusControl } from "@/components/JobStatusControl";
import { PublishControl } from "@/components/PublishControl";

// The requisition manage screen: details, interview rounds, hiring team, and the status lifecycle.
// 404s both when RLS hides the job AND when the viewer can see it but may not manage it (an
// interviewer) — a read-only management screen would be misleading.
export default async function ManageJobPage({ params }) {
  const { id } = await params; // async in Next 16
  const t = await getT();

  const data = await getJobForManage(id);
  if (!data || !data.canManage) notFound();
  const { job } = data;

  const [{ departments }, assignable] = await Promise.all([getJobFormData(), getAssignableEmployees()]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <Link href={`/jobs/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("board.back")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <JobStatusBadge status={job.status} label={t(`enum.jobStatus.${job.status}`)} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("jobs.manageTitle")}</p>

      <div className="mt-4 flex flex-col gap-3">
        <JobStatusControl jobId={id} status={job.status} statuses={JOB_STATUSES} />
        <PublishControl jobId={id} publishedAt={job.publishedAt} isOpen={job.status === "OPEN"} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Card title={t("jobForm.details")}>
          <JobForm job={job} departments={departments} employmentTypes={JOB_EMPLOYMENT_TYPES} />
        </Card>

        <Card title={t("rounds.title")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("rounds.subtitle")}</p>
          <RoundEditor jobId={id} rounds={job.interviewRounds} />
        </Card>

        <Card title={t("team.title")}>
          <p className="mb-3 text-xs text-muted-foreground">{t("team.subtitle")}</p>
          <TeamEditor jobId={id} members={job.members} assignable={assignable} roles={JOB_MEMBER_ROLES} />
        </Card>
      </div>
    </main>
  );
}
