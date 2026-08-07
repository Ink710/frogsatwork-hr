"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { addRound, renameRound, removeRound } from "@/app/(internal)/jobs/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// One existing round: inline rename + remove. Removing is safe by design — Application.currentRoundId
// is ON DELETE SET NULL, so a candidate sitting in this round stays in INTERVIEW with no round rather
// than being orphaned, and their history keeps the round NAME (a snapshot on ApplicationEvent).
function RoundRow({ jobId, round, index }) {
  const t = useT();
  const [renameState, renameAction, renaming] = useActionState(renameRound.bind(null, jobId, round.id), undefined);
  const [removeState, removeAction, removing] = useActionState(removeRound.bind(null, jobId, round.id), undefined);
  const error = renameState?.error || removeState?.error;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
        <form action={renameAction} className="flex flex-1 items-center gap-2">
          <input name="name" defaultValue={round.name} required className={`${INPUT} flex-1`} aria-label={t("rounds.name")} />
          <button type="submit" disabled={renaming} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60">
            {t("rounds.rename")}
          </button>
        </form>
        <form action={removeAction}>
          <button
            type="submit"
            disabled={removing}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {t("rounds.remove")}
          </button>
        </form>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function RoundEditor({ jobId, rounds }) {
  const t = useT();
  const [state, action, pending] = useActionState(addRound.bind(null, jobId), undefined);

  return (
    <div>
      {rounds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rounds.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rounds.map((r, i) => (
            <RoundRow key={r.id} jobId={jobId} round={r} index={i} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 flex items-center gap-2">
        <input name="name" required placeholder={t("rounds.name")} aria-label={t("rounds.name")} className={`${INPUT} flex-1`} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {t("rounds.add")}
        </button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
