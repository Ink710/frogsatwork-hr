import Link from "next/link";
import { notFound } from "next/navigation";
import { INTL_LOCALE, formatDate, initials } from "@hris/ui";
import { Avatar, Card, Field, FieldGrid } from "@hris/ui/server";
import { getViewer } from "@hris/auth";
import { getT, getLocale } from "@/lib/i18n.server";
import { getCandidateProfile, canManageErasure, canArchiveCandidate } from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";
import { EraseCandidateForm } from "@/components/ErasureActions";
import { ArchiveControl } from "@/components/ArchiveControl";

// One person, every application. This is what the Candidate/Application split from M1 exists for:
// "have we seen this person before?" is answerable at a glance, including past rejections.
export default async function CandidateProfilePage({ params }) {
  const { id } = await params; // async in Next 16
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];

  const candidate = await getCandidateProfile(id);
  if (!candidate) notFound();

  const erased = Boolean(candidate.anonymisedAt);
  // Whether this person became an employee. Resolved here so the erase control can explain the
  // refusal up front rather than the database delivering it as an error after the fact.
  const wasHired = candidate.applications.some((a) => a.hiredEmployeeId);
  const archived = Boolean(candidate.archivedAt);
  const [canErase, viewer] = await Promise.all([canManageErasure(), getViewer()]);
  const canArchive = canArchiveCandidate(viewer);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/candidates" className="text-sm text-muted-foreground hover:text-foreground">
        {t("profile.back")}
      </Link>

      <div className="mt-3 flex items-center gap-4">
        <Avatar
          initials={erased ? "—" : initials(candidate.firstName, candidate.lastName)}
          className="h-14 w-14 text-lg"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {erased ? t("compliance.tombstone") : `${candidate.firstName} ${candidate.lastName}`}
          </h1>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">
            {erased
              ? t("compliance.erasedOn", { date: formatDate(candidate.anonymisedAt, locale) })
              : candidate.email}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {/* The application history below survives an erasure intact — stages, dates and outcomes are
            facts about the process, not about the person. Only the identity is gone. */}
        <Card title={t("profile.details")}>
          <FieldGrid>
            {erased ? (
              <>
                <Field label={t("compliance.erasedLabel")}>
                  {formatDate(candidate.anonymisedAt, locale)}
                </Field>
                {candidate.anonymisationNote && (
                  <Field label={t("compliance.noteLabel")}>{candidate.anonymisationNote}</Field>
                )}
              </>
            ) : (
              <>
                <Field label={t("app.email")}>{candidate.email}</Field>
                {candidate.phone && <Field label={t("app.phone")}>{candidate.phone}</Field>}
              </>
            )}
            {/* `source` outlives an erasure on purpose: it describes a channel, not a person, and
                every source-effectiveness figure on /reports depends on it. */}
            {candidate.source && <Field label={t("app.source")}>{candidate.source}</Field>}
            <Field label={t("profile.applicationsLabel")}>
              {t("candidates.applications", { n: candidate.applications.length })}
            </Field>
          </FieldGrid>
        </Card>

        {/* Erasure lives behind the same HR_ADMIN gate as /compliance. Not shown once the record is
            already a shell — there is nothing left to erase, and app_erase_candidate would answer
            ALREADY_ERASED. */}
        {/* Archiving sits ABOVE erasure on purpose: it's the reversible option, and the one a
            recruiter reaching for "get this out of my way" actually wants. Hidden for erased shells
            — the tombstone is already out of the pool. */}
        {canArchive && !erased && (
          <Card title={t("archive.title")}>
            {archived && (
              <p className="mb-3 text-xs text-muted-foreground">
                {candidate.archivedByName
                  ? t("archive.archivedByPerson", {
                      date: formatDate(candidate.archivedAt, locale),
                      name: candidate.archivedByName,
                    })
                  : // No person recorded ⇒ the retention sweep did it.
                    t("archive.archivedByPolicy", { date: formatDate(candidate.archivedAt, locale) })}
              </p>
            )}
            <ArchiveControl candidateId={candidate.id} archived={archived} />
          </Card>
        )}

        {canErase && !erased && (
          <Card title={t("compliance.eraseFromProfile")}>
            <EraseCandidateForm candidateId={candidate.id} blocked={wasHired} />
          </Card>
        )}

        <Card title={t("profile.history")}>
          {candidate.applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("candidates.noApplications")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {candidate.applications.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{a.job.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {t("profile.appliedOn", { date: formatDate(a.appliedAt, locale) })}
                      </p>
                      {a.currentRound && (
                        <p className="mt-0.5 text-xs text-primary">
                          {t("profile.round")}: {a.currentRound.name}
                        </p>
                      )}
                      {a.rejectionReason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("profile.rejectionReason")}: {a.rejectionReason}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StageBadge stage={a.stage} label={t(`enum.applicationStage.${a.stage}`)} />
                      <Link
                        href={`/jobs/${a.job.id}/applications/${a.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {t("profile.viewPipeline")}
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
