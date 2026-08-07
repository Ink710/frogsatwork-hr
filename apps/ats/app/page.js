import Link from "next/link";
import { getT } from "@/lib/i18n.server";
import { getJobsForViewer } from "@/lib/queries";
import { JobStatusBadge } from "@/components/recruiting-ui";

// Landing: the jobs (requisitions) the viewer can access. RLS scopes this — a recruiter/HR sees the
// whole org; a hiring-team member sees their reqs; anyone else sees an empty list.
export default async function JobsPage() {
  const t = await getT();
  const jobs = await getJobsForViewer();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("jobs.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("jobs.subtitle")}</p>

      {jobs.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("jobs.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{j.title}</h2>
                      <JobStatusBadge status={j.status} label={t(`enum.jobStatus.${j.status}`)} />
                    </div>
                    {j.location && <p className="mt-0.5 text-sm text-muted-foreground">{j.location}</p>}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p className="font-mono">{t("jobs.applications", { n: j.applicationCount })}</p>
                    <p className="mt-1 text-primary">{t("jobs.viewBoard")}</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
