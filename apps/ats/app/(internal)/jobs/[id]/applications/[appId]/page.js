import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE, formatDate, formatDateTime, initials } from "@hris/ui";
import {
  getApplicationDetail,
  getMyScorecard,
  getApplicationScorecards,
  getOfferPanel,
  getSchedulingPanel,
} from "@/lib/queries";
import { getViewer } from "@hris/auth";
import { signApplicationResumeDownload } from "@/lib/sign";
import { StageBadge, ResumeLink } from "@/components/recruiting-ui";
import { ScorecardForm } from "@/components/ScorecardForm";
import { DebriefPanel } from "@/components/DebriefPanel";
import { OfferPanel } from "@/components/OfferPanel";
import { AssignSlot } from "@/components/AssignSlot";
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

// The snapshot stores ISO timestamps (the form collects month precision). Rendered as YYYY-MM
// rather than a full date so it reads like the CV it came from.
function monthLabel(value) {
  return typeof value === "string" ? value.slice(0, 7) : "";
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
  const [mine, debrief, offerPanel, viewer] = await Promise.all([
    getMyScorecard(appId),
    getApplicationScorecards(appId),
    getOfferPanel(id, appId),
    getViewer(),
  ]);

  const { app, canManage } = detail;
  const c = app.candidate;

  // M9: scheduling, scoped to the round this application is actually in — offering a time for a
  // round they have not reached would book an interview nobody expects. Read after `app` because it
  // needs currentRoundId.
  const scheduling = await getSchedulingPanel(id, appId, app.currentRoundId);

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
            {/* M1: this APPLICATION's channel, not the candidate's first touch. This page is about
                one submission, so the campaign that produced it is the relevant fact; first touch
                lives on the candidate profile. */}
            {app.source && <Field label={t("app.source")}>{app.source}</Field>}
            <Field label={t("app.appliedLabel")}>{formatDate(app.appliedAt, locale)}</Field>
            {app.currentRound && <Field label={t("app.currentRound")}>{app.currentRound.name}</Field>}
            {/* Right beside the scorecard an interviewer is about to write — the CV is the thing
                they read first, and RLS lets the whole hiring team through (see the route). */}
            {/* ⚠️ M7: THE APPLICATION'S CV, NOT THE CANDIDATE'S. Until M7 these were the same file
                by definition — a résumé could not be replaced. Now that an applicant manages their
                own, reading `c.resumeFileName` here would hand an interviewer whatever CV is
                current, with a scorecard beside it about a document nobody can produce any more.
                The candidate PROFILE page still shows the current one; that is a different
                question and both are worth answering. */}
            {app.resumeFileName && (
              <Field label={t("resume.label")}>
                <ResumeLink
                  href={signApplicationResumeDownload(app.id, viewer.userId)}
                  fileName={app.resumeFileName}
                  label={t("resume.download")}
                />
              </Field>
            )}
          </FieldGrid>
        </Card>

        {/* M9 — the interview time. Only while they are IN the interview stage: a slot picker on an
            application at Applied or Offer is an invitation to schedule the wrong thing. */}
        {app.stage === "INTERVIEW" && canManage && (
          <Card title={t("slots.assignTitle")}>
            <AssignSlot
              jobId={id}
              appId={appId}
              slots={scheduling.slots}
              booked={scheduling.booked}
              locale={locale}
            />
          </Card>
        )}

        {/* Their answers to this req's screening questions (M6b). The prompt shown is the SNAPSHOT
            taken when they answered — reword the question next quarter and this still reads as the
            question they were actually asked. */}
        {app.answers?.length > 0 && (
          <Card title={t("answers.title")}>
            <dl className="flex flex-col gap-3">
              {app.answers.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{a.promptSnapshot}</dt>
                  <dd className="mt-1 text-sm whitespace-pre-line">{a.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {/* WHAT THEY SUBMITTED (M6) — read from the application's frozen snapshot, never from the
            candidate's live profile. The applicant can edit their profile at any time; what a
            recruiter reviews must stay exactly what arrived, or a decision gets made against
            different facts than the ones on screen. */}
        {(app.employmentSnapshot?.length > 0 || app.educationSnapshot?.length > 0) && (
          <Card title={t("submitted.title")}>
            <p className="mb-3 text-xs text-muted-foreground">{t("submitted.hint")}</p>

            {app.employmentSnapshot?.length > 0 && (
              <ul className="flex flex-col gap-3">
                {app.employmentSnapshot.map((e, i) => (
                  <li key={`emp-${i}`} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-sm text-muted-foreground">{e.employer}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {monthLabel(e.startDate)} – {e.endDate ? monthLabel(e.endDate) : t("submitted.present")}
                    </p>
                    {e.summary && <p className="mt-2 text-sm">{e.summary}</p>}
                  </li>
                ))}
              </ul>
            )}

            {app.educationSnapshot?.length > 0 && (
              <ul className="mt-3 flex flex-col gap-3">
                {app.educationSnapshot.map((e, i) => (
                  <li key={`edu-${i}`} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{e.qualification}</p>
                    <p className="text-sm text-muted-foreground">{e.institution}</p>
                    {(e.startDate || e.endDate) && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {[e.startDate && monthLabel(e.startDate), e.endDate && monthLabel(e.endDate)]
                          .filter(Boolean)
                          .join(" – ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

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
