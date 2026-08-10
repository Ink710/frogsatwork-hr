"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { RECOMMENDATIONS, RATING_SCALE } from "@hris/recruiting";
import { saveScorecardDraft, submitScorecard } from "@/app/(internal)/jobs/scorecards";

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// The viewer's own feedback. Two submit buttons on ONE form (save draft / submit) so the typed
// values go to whichever action you press — the same trick as the timesheet grid.
//
// Once submitted the whole thing renders read-only. That's a courtesy, not the enforcement: the
// scorecard_update RLS policy refuses edits to a SUBMITTED row no matter what this component does.
export function ScorecardForm({ applicationId, competencies, scorecard }) {
  const t = useT();
  const [saveState, saveAction, saving] = useActionState(saveScorecardDraft.bind(null, applicationId), undefined);
  const [subState, subAction, submitting] = useActionState(submitScorecard.bind(null, applicationId), undefined);

  const submitted = scorecard?.status === "SUBMITTED";
  const ratingFor = (id) => scorecard?.ratings?.find((r) => r.competencyId === id);
  const error = saveState?.error || subState?.error;
  const savedOk = saveState?.saved;

  if (submitted) {
    return (
      <div>
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{t("score.locked")}</p>
        <dl className="mt-4 flex flex-col gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("score.recommendation")}</dt>
            <dd className="text-sm font-medium">{t(`enum.recommendation.${scorecard.recommendation}`)}</dd>
          </div>
          {competencies.map((c) => {
            const r = ratingFor(c.id);
            return (
              <div key={c.id}>
                <dt className="text-xs text-muted-foreground">{c.name}</dt>
                <dd className="font-mono text-sm">
                  {r ? `${r.rating}/4` : "—"}
                  {r?.comment && <span className="ml-2 font-sans text-xs text-muted-foreground">{r.comment}</span>}
                </dd>
              </div>
            );
          })}
          {scorecard.notes && (
            <div>
              <dt className="text-xs text-muted-foreground">{t("score.notes")}</dt>
              <dd className="whitespace-pre-line text-sm">{scorecard.notes}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5">
      {competencies.length === 0 && <p className="text-sm text-muted-foreground">{t("score.noComps")}</p>}

      {competencies.map((c) => {
        const r = ratingFor(c.id);
        return (
          <div key={c.id} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{c.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {RATING_SCALE.map((n) => (
                <label key={n} className="flex items-center gap-1 text-sm">
                  <input type="radio" name={`rating:${c.id}`} value={n} defaultChecked={r?.rating === n} />
                  <span className="font-mono">{n}</span>
                </label>
              ))}
            </div>
            <input
              name={`comment:${c.id}`}
              defaultValue={r?.comment ?? ""}
              placeholder={t("score.commentPlaceholder")}
              aria-label={`${c.name} — ${t("score.comment")}`}
              className={INPUT}
            />
          </div>
        );
      })}

      <div>
        <label className="block text-sm font-medium" htmlFor="recommendation">
          {t("score.recommendation")}
        </label>
        <select id="recommendation" name="recommendation" defaultValue={scorecard?.recommendation ?? ""} className={INPUT}>
          <option value="">{t("score.pickRecommendation")}</option>
          {RECOMMENDATIONS.map((r) => (
            <option key={r} value={r}>
              {t(`enum.recommendation.${r}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="notes">
          {t("score.notes")}
        </label>
        <textarea id="notes" name="notes" rows={4} defaultValue={scorecard?.notes ?? ""} className={INPUT} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          formAction={saveAction}
          disabled={saving || submitting}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {t("score.saveDraft")}
        </button>
        <button
          type="submit"
          formAction={subAction}
          disabled={saving || submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {t("score.submit")}
        </button>
        {savedOk && <span className="text-xs text-success">{t("score.saved")}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{t("score.submitWarning")}</p>
    </form>
  );
}
