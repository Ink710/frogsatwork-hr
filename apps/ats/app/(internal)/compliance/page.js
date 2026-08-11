import Link from "next/link";
import { notFound } from "next/navigation";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { Card } from "@hris/ui/server";
import { EEO_MIN_CELL } from "@hris/recruiting";
import { getT, getLocale } from "@/lib/i18n.server";
import {
  getEeoSummary,
  getErasureRequests,
  canManageErasure,
  canFileEeo,
  getEeoExportHistory,
} from "@/lib/queries";
import { EraseCandidateForm, RefuseErasureForm } from "@/components/ErasureActions";

// The compliance screen — EEO aggregates, exports, and the erasure queue.
//
// Deliberately NOT a section of /reports. That page is visible to hiring managers and interviewers,
// and the entire promise made to applicants on the careers site is that their self-identification
// never reaches the hiring team. A page that is HR-only by construction is easier to keep honest
// than a section that must remember to hide itself.
//
// ⚠️ THREE different gates on one page, and they are genuinely different questions (M12):
//   canReadEeo        — may you open this page and see suppressed aggregates? HR_ADMIN + HR_GENERALIST
//   canFileEeo        — may you download EXACT counts?                        HR_ADMIN
//   canManageErasure  — may you destroy someone's personal data?              HR_ADMIN
// Collapsing them into one role check would mean either locking a generalist out of routine
// reporting or handing them irreversible powers. Each section asks its own question.
//
// notFound() rather than a "you don't have access" screen: a 404 doesn't confirm the page exists.
export default async function CompliancePage() {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];

  const [eeo, canFile, canErase, exportHistory] = await Promise.all([
    getEeoSummary(),
    canFileEeo(),
    canManageErasure(),
    getEeoExportHistory(),
  ]);
  // getEeoSummary returns null when the viewer isn't permitted — the page's entry condition.
  if (!eeo) notFound();

  const requests = canErase ? await getErasureRequests({ status: "PENDING" }) : [];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("compliance.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("compliance.subtitle")}</p>

      <div className="mt-6 flex flex-col gap-6">
        {/* ── Applicant demographics ─────────────────────────────────────────────────────────── */}
        <Card title={t("compliance.eeoTitle")}>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("compliance.eeoHint")}</p>

          {eeo.totalResponses === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t("compliance.eeoEmpty")}
            </p>
          ) : (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("compliance.responses", { n: eeo.totalResponses })}
              </p>

              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                {eeo.dimensions.map((d) => (
                  <div key={d.dimension} className="rounded-lg border border-border p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t(`compliance.dimension.${d.dimension}`)}
                    </p>
                    <dl className="mt-3 flex flex-col gap-1.5">
                      {d.cells.map((c) => (
                        <div key={c.value} className="flex items-baseline justify-between gap-3 text-sm">
                          <dt className="text-muted-foreground">
                            {t(`enum.eeo.${d.dimension}.${c.value}`)}
                          </dt>
                          {/* A withheld cell renders as an em dash, never as 0 — "fewer than five
                              people" and "nobody" are different facts. */}
                          <dd
                            className={
                              c.suppressed ? "font-medium text-muted-foreground" : "font-medium tabular-nums"
                            }
                          >
                            {c.suppressed ? t("compliance.suppressed") : c.responses}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>

              {eeo.dimensions.some((d) => d.hasSuppression) && (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  {t("compliance.suppressionNote", { n: EEO_MIN_CELL })}
                </p>
              )}
            </>
          )}
        </Card>

        {/* ── Exports ────────────────────────────────────────────────────────────────────────── */}
        <Card title={t("export.title")}>
          <div className="flex flex-col gap-4">
            {/* Suppressed: the same figures as above, safe to circulate. */}
            <div>
              <a
                href="/api/eeo-export?variant=summary"
                className="inline-block rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                {t("export.summary")}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">{t("export.summaryHint")}</p>
            </div>

            {/* EXACT counts. Only rendered for a viewer who may actually obtain them — the route
                returns 403 regardless, but offering a button that always fails teaches nothing. */}
            {canFile && (
              <div>
                <a
                  href="/api/eeo-export?variant=filing"
                  className="inline-block rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  {t("export.filing")}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">{t("export.filingHint")}</p>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs font-medium">{t("export.historyTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("export.historyHint")}</p>
            {exportHistory.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("export.historyEmpty")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {exportHistory.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span>
                      <span className="font-medium">{t(`enum.eeoExportVariant.${e.variant}`)}</span>
                      {" · "}
                      {e.actorName}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(e.exportedAt, locale)} · {t("export.rows", { n: e.rowCount })}
                      {e.uncategorisedJobs > 0 &&
                        ` · ${t("export.uncategorisedWarning", { n: e.uncategorisedJobs })}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* ── Erasure queue ──────────────────────────────────────────────────────────────────── */}
        {/* Hidden for a generalist: erasure is irreversible, so it stays with HR_ADMIN. Showing a
            queue they cannot action would be the M8 mistake again — visibility must follow
            capability. */}
        {canErase && (
        <Card title={t("compliance.queueTitle")}>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("compliance.queueHint")}</p>

          {requests.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t("compliance.queueEmpty")}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {requests.map((r) => {
                // Was this person hired? Resolved server-side from the application relation, so the
                // form can explain the refusal instead of the database delivering it as an error.
                const wasHired = (r.candidate?.applications?.length ?? 0) > 0;
                return (
                  <li key={r.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-sm">{r.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("compliance.requestedOn", { date: formatDate(r.requestedAt, locale) })}
                      </p>
                    </div>

                    {r.candidate && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <Link
                          href={`/candidates/${r.candidate.id}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {r.candidate.firstName} {r.candidate.lastName}
                        </Link>
                      </p>
                    )}

                    {r.reason && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium">{t("compliance.reasonGiven")}</span> {r.reason}
                      </p>
                    )}

                    <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                      {r.candidateId && (
                        <EraseCandidateForm candidateId={r.candidateId} blocked={wasHired} />
                      )}
                      <RefuseErasureForm requestId={r.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        )}
      </div>
    </main>
  );
}
