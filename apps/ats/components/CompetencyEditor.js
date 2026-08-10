"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { addCompetency, renameCompetency, removeCompetency } from "@/app/(internal)/jobs/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// One criterion: inline rename + remove. Removing is safe — every ScorecardRating stores a
// competencyName SNAPSHOT, so past debriefs keep saying exactly what they said.
function CompetencyRow({ jobId, competency, index }) {
  const t = useT();
  const [renameState, renameAction, renaming] = useActionState(
    renameCompetency.bind(null, jobId, competency.id),
    undefined,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeCompetency.bind(null, jobId, competency.id),
    undefined,
  );
  const error = renameState?.error || removeState?.error;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
        <form action={renameAction} className="flex flex-1 items-center gap-2">
          <input name="name" defaultValue={competency.name} required className={`${INPUT} flex-1`} aria-label={t("comps.name")} />
          <button type="submit" disabled={renaming} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60">
            {t("comps.rename")}
          </button>
        </form>
        <form action={removeAction}>
          <button
            type="submit"
            disabled={removing}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {t("comps.remove")}
          </button>
        </form>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function CompetencyEditor({ jobId, competencies }) {
  const t = useT();
  const [state, action, pending] = useActionState(addCompetency.bind(null, jobId), undefined);

  return (
    <div>
      {competencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("comps.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {competencies.map((c, i) => (
            <CompetencyRow key={c.id} jobId={jobId} competency={c} index={i} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 flex items-center gap-2">
        <input name="name" required placeholder={t("comps.name")} aria-label={t("comps.name")} className={`${INPUT} flex-1`} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {t("comps.add")}
        </button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
