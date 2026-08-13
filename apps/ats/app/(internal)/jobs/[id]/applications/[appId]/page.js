import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE, formatDate, formatDateTime, initials } from "@hris/ui";
import {
  getApplicationDetail,
  getMyScorecard,
  getApplicationScorecards,
  getOfferPanel,
} from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";
import { ScorecardForm } from "@/components/ScorecardForm";
import { DebriefPanel } from "@/components/DebriefPanel";
import { OfferPanel } from "@/components/OfferPanel";
import { Avatar, Card, Field, FieldGrid } from "@hris/ui/server";

// Human label for one pipeline event: the initial application, an interview-round advance
// (INTERVIEW→INTERVIEW), or a stage move.
function eventLabel(ev, t) {
  if (!ev.fromStage) return t("app.event.applied");
  if (ev.fromStage === ev.toStage && ev.roundName) return t("app.event.round", { round: ev.roundName });
  const label = t("app.event.moved", {
    from: t(`enum.applicationStage.${ev.fromStage}`),
    to: t(`enum.applicationStage.${ev.toStage}`),
  });
  return ev.roundName ? `${label} · ${ev.roundName}` : label;
}

export default async function ApplicationDetailPage({ params }) {
  const { id, appId } = await params; // async in Next 16
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const detail = await getApplicationDetail(id, appId);
  if (!detail) notFound();

  // Feedback: the viewer's own scorecard (anyone on the hiring team may write one) and the debrief
  // of everything they're allowed to read. The withholding happens in RLS, not here.
  // Compensation (M14): null unless the viewer may MANAGE this req, so an interviewer's payload
  // carries no offer data at all — not hidden data, absent data.
  const [mine, debrief, offerPanel] = await Promise.all([
    getMyScorecard(appId),
    getApplicationScorecards(appId),
    getOfferPanel(id, appId),
  ]);

  const { app } = detail;
  const c = app.candidate;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <Link href={`/jobs/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("board.back")}
      </Link>

      <div className="mt-3 flex items-center gap-4">
        <Avatar initials={initials(c.firstName, c.lastName)} className="h-14 w-14 text-lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.firstName} {c.lastName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{app.job.title}</p>
        </div>
        <div className="ml-auto">
          <StageBadge stage={app.stage} label={t(`enum.applicationStage.${app.stage}`)} />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {app.stage === "HIRED" && (
          <p className={`rounded-md px-3 py-2 text-sm ${app.hiredEmployee ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
            {/* The other side of the hire seam: recruiters can see whether HR has completed the
                onboarding, without needing access to employee-records itself. */}
            {app.hiredEmployee
              ? t("hire.done", { number: app.hiredEmployee.employeeNumber })
              : t("hire.pending")}
          </p>
        )}

        <Card title={t("app.title")}>
          <FieldGrid>
            <Field label={t("app.email")}>{c.email}</Field>
            {c.phone && <Field label={t("app.phone")}>{c.phone}</Field>}
            {c.source && <Field label={t("app.source")}>{c.source}</Field>}
            <Field label={t("app.appliedLabel")}>{formatDate(app.appliedAt, locale)}</Field>
            {app.currentRound && <Field label={t("app.currentRound")}>{app.currentRound.name}</Field>}
          </FieldGrid>
        </Card>

        {offerPanel && (
          <Card title={t("offer.title")}>
            <OfferPanel jobId={id} appId={appId} panel={offerPanel} />
          </Card>
        )}

        {mine && (
          <Card title={t("score.title")}>
            <p className="mb-3 text-xs text-muted-foreground">{t("score.subtitle")}</p>
            <ScorecardForm
              applicationId={appId}
              competencies={mine.competencies}
              scorecard={mine.scorecard}
              canStartFeedback={mine.canStartFeedback}
            />
          </Card>
        )}

        <Card title={t("debrief.title")}>
          <DebriefPanel scorecards={debrief.scorecards} hiddenCount={debrief.hiddenCount} />
        </Card>

        <Card title={t("app.timeline")}>
          <ol className="flex flex-col gap-3">
            {app.events.map((ev) => (
              <li key={ev.id} className="flex items-start gap-3 border-l-2 border-border pl-3">
                <div>
                  <p className="text-sm font-medium">{eventLabel(ev, t)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{formatDateTime(ev.occurredAt, locale)}</p>
                  {ev.note && <p className="mt-0.5 text-xs text-muted-foreground">{ev.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </main>
  );
}
