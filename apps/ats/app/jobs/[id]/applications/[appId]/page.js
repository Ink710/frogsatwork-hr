import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate, formatDateTime, initials } from "@/lib/format";
import { getApplicationDetail } from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";
import { Avatar, Card, Field, FieldGrid } from "@/components/profile-ui";

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
        <Card title={t("app.title")}>
          <FieldGrid>
            <Field label={t("app.email")}>{c.email}</Field>
            {c.phone && <Field label={t("app.phone")}>{c.phone}</Field>}
            {c.source && <Field label={t("app.source")}>{c.source}</Field>}
            <Field label={t("app.appliedLabel")}>{formatDate(app.appliedAt, locale)}</Field>
            {app.currentRound && <Field label={t("app.currentRound")}>{app.currentRound.name}</Field>}
          </FieldGrid>
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
