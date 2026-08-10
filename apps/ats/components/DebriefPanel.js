import { averageRating } from "@hris/recruiting";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { RecommendationBadge } from "@/components/recruiting-ui";

// Everyone's feedback on this candidate — as far as the viewer is allowed to read it.
//
// `hiddenCount` is the honest part: RLS withholds colleagues' scorecards until you've submitted your
// own, and silently showing fewer rows would read as "nobody has reviewed yet". Saying "2 colleagues
// have submitted — submit yours to read them" states the rule instead of disguising it.
export async function DebriefPanel({ scorecards, hiddenCount }) {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const submitted = scorecards.filter((s) => s.status === "SUBMITTED");

  if (submitted.length === 0 && hiddenCount === 0) {
    return <p className="text-sm text-muted-foreground">{t("debrief.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {hiddenCount > 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          {t("debrief.hidden", { n: hiddenCount })}
        </p>
      )}

      {submitted.map((s) => {
        const avg = averageRating(s.ratings);
        return (
          <article key={s.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {s.authorName}
                  {s.isMine && <span className="ml-2 text-xs text-muted-foreground">{t("debrief.you")}</span>}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {t("debrief.submittedOn", { date: formatDate(s.submittedAt, locale) })}
                  {avg !== null && ` · ${t("debrief.average", { n: avg })}`}
                </p>
              </div>
              <RecommendationBadge
                recommendation={s.recommendation}
                label={t(`enum.recommendation.${s.recommendation}`)}
              />
            </div>

            {s.ratings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {s.ratings.map((r) => (
                  <li key={r.id} className="text-sm">
                    {/* competencyName is the SNAPSHOT — renaming or deleting the competency later
                        can never rewrite what this debrief said. */}
                    <span className="text-muted-foreground">{r.competencyName}</span>{" "}
                    <span className="font-mono">{r.rating}/4</span>
                    {r.comment && <span className="ml-2 text-xs text-muted-foreground">{r.comment}</span>}
                  </li>
                ))}
              </ul>
            )}

            {s.notes && <p className="mt-3 whitespace-pre-line text-sm">{s.notes}</p>}
          </article>
        );
      })}
    </div>
  );
}
