import { Card } from "@hris/ui/server";
import { isRecruiter } from "@hris/auth";
import { getViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import {
  getFunnelReport,
  getSourceReport,
  getTimeReport,
  getReqAgingReport,
  getInterviewerLoadReport,
} from "@/lib/queries";

// Recruiting analytics. Every figure below was computed inside withViewer, so RLS already narrowed
// the rows: a recruiter sees the organisation, a hiring manager sees their own reqs — same code.
// The scope note in the header exists so nobody misreads their subset as company-wide.
export default async function ReportsPage() {
  const t = await getT();
  const [viewer, funnelReport, sources, times, aging, load] = await Promise.all([
    getViewer(),
    getFunnelReport(),
    getSourceReport(),
    getTimeReport(),
    getReqAgingReport(),
    getInterviewerLoadReport(),
  ]);

  const { funnel, totalApplications } = funnelReport;
  const orgWide = isRecruiter(viewer?.role);
  const maxReached = Math.max(1, ...funnel.map((f) => f.reached));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("reports.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {orgWide ? t("reports.scopeOrg") : t("reports.scopeMine")}
      </p>

      {totalApplications === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t("reports.empty")}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* Time metrics — two different questions, never conflated. Sample size is shown next to
              each because "18 days" from 2 hires is a very different claim than from 200. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { label: t("reports.timeToHire"), hint: t("reports.timeToHireHint"), v: times.timeToHire },
              { label: t("reports.timeToFill"), hint: t("reports.timeToFillHint"), v: times.timeToFill },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  {m.v.days === null ? "—" : t("reports.days", { n: m.v.days })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {m.v.sample === 0 ? t("reports.noHires") : t("reports.sample", { n: m.v.sample })}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{m.hint}</p>
              </div>
            ))}
          </div>

          <Card title={t("reports.funnel")}>
            <p className="mb-4 text-xs text-muted-foreground">{t("reports.funnelHint")}</p>
            <ul className="flex flex-col gap-3">
              {funnel.map((row) => (
                <li key={row.stage}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t(`enum.applicationStage.${row.stage}`)}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.reached}
                      {row.conversionFromPrevious !== null && ` · ${row.conversionFromPrevious}%`}
                      {row.dropOff ? ` · −${row.dropOff}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((row.reached / maxReached) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {sources.length > 0 && (
            <Card title={t("reports.sources")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2">{t("reports.source")}</th>
                    <th className="pb-2 text-right">{t("reports.applications")}</th>
                    <th className="pb-2 text-right">{t("reports.hires")}</th>
                    <th className="pb-2 text-right">{t("reports.hireRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source} className="border-t border-border">
                      <td className="py-2">{s.source}</td>
                      <td className="py-2 text-right font-mono">{s.applications}</td>
                      <td className="py-2 text-right font-mono">{s.hires}</td>
                      <td className="py-2 text-right font-mono">{s.hireRate === null ? "—" : `${s.hireRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {aging.length > 0 && (
            <Card title={t("reports.aging")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("reports.agingHint")}</p>
              <ul className="flex flex-col gap-2">
                {aging.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("reports.inFlight", { n: j.inFlight })} · {t("jobs.openings", { n: j.openings })}
                        {!j.published && ` · ${t("reports.notPublished")}`}
                      </p>
                    </div>
                    <span className="font-mono text-sm">{t("reports.daysOpen", { n: j.daysOpen })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Hidden entirely for interviewers: the anchoring guard means they can't read colleagues'
              scorecards, so these totals would be silently incomplete. */}
          {load && load.length > 0 && (
            <Card title={t("reports.interviewerLoad")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2">{t("reports.interviewer")}</th>
                    <th className="pb-2 text-right">{t("reports.submitted")}</th>
                    <th className="pb-2 text-right">{t("reports.drafts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {load.map((r) => (
                    <tr key={r.employeeId} className="border-t border-border">
                      <td className="py-2">{r.name}</td>
                      <td className="py-2 text-right font-mono">{r.submitted}</td>
                      <td className="py-2 text-right font-mono">{r.drafts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
