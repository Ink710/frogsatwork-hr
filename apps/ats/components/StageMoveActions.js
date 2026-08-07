"use client";

import { useActionState } from "react";
import { moveApplication, advanceRound } from "@/app/(internal)/jobs/actions";

// The move controls on a pipeline card. `buttons` is prepared server-side (labels already translated,
// pipeline rules already applied), so this stays a thin dispatcher:
//   { kind: "move", toStage, label, tone }  → moveApplication (hidden toStage)
//   { kind: "round", label, tone }          → advanceRound
// Only rendered when the viewer can manage the job (interviewers never see it).
const TONE = {
  primary: "border-primary/40 text-primary hover:bg-primary/10",
  danger: "border-destructive/40 text-destructive hover:bg-destructive/10",
  muted: "border-border text-muted-foreground hover:bg-muted",
};

export function StageMoveActions({ jobId, appId, buttons }) {
  const [moveState, moveAction, movePending] = useActionState(moveApplication.bind(null, jobId, appId), undefined);
  const [roundState, roundAction, roundPending] = useActionState(advanceRound.bind(null, jobId, appId), undefined);
  const error = moveState?.error || roundState?.error;

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {buttons.map((b, i) =>
          b.kind === "round" ? (
            <form key={i} action={roundAction}>
              <button
                type="submit"
                disabled={roundPending}
                className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-60 ${TONE[b.tone] ?? TONE.muted}`}
              >
                {b.label}
              </button>
            </form>
          ) : (
            <form key={i} action={moveAction}>
              <input type="hidden" name="toStage" value={b.toStage} />
              <button
                type="submit"
                disabled={movePending}
                className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-60 ${TONE[b.tone] ?? TONE.muted}`}
              >
                {b.label}
              </button>
            </form>
          ),
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
