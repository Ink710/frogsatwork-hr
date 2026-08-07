import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n.server";
import { getJobBoard } from "@/lib/queries";
import { JobStatusBadge } from "@/components/recruiting-ui";
import { PipelineBoard } from "@/components/PipelineBoard";

// The pipeline board for one requisition. notFound() when RLS hides the job (a user not on its team).
export default async function JobBoardPage({ params }) {
  const { id } = await params; // params is async in Next 16
  const t = await getT();
  const board = await getJobBoard(id);
  if (!board) notFound();

  const { job } = board;
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        {t("board.back")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <JobStatusBadge status={job.status} label={t(`enum.jobStatus.${job.status}`)} />
        {board.canManage && (
          <Link
            href={`/jobs/${id}/manage`}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            {t("jobs.manage")}
          </Link>
        )}
      </div>
      {job.location && (
        <p className="mt-1 text-sm text-muted-foreground">
          {job.location} · {t("jobs.openings", { n: job.openings })}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <PipelineBoard jobId={id} board={board} />
      </div>
    </main>
  );
}
