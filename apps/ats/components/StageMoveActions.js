"use client";

import { useActionState, useState } from "react";
import { moveApplication, advanceRound } from "@/app/(internal)/jobs/actions";

// The move controls on a pipeline card. `buttons` is prepared server-side (labels already translated,
// pipeline rules already applied), so this stays a thin dispatcher:
//   { kind: "move", toStage, label, tone }  → moveApplication (hidden toStage)
//   { kind: "round", label, tone }          → advanceRound
//   { kind: "reject", label, tone }         → expands into the reason form below
// Only rendered when the viewer can manage the job (interviewers never see it).
const TONE = {
  primary: "border-primary/40 text-primary hover:bg-primary/10",
  danger: "border-destructive/40 text-destructive hover:bg-destructive/10",
  muted: "border-border text-muted-foreground hover:bg-muted",
};
const BTN = "rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-60";

export function StageMoveActions({ jobId, appId, buttons, rejectionOptions = [], labels = {} }) {
  const [moveState, moveAction, movePending] = useActionState(moveApplication.bind(null, jobId, appId), undefined);
  const [roundState, roundAction, roundPending] = useActionState(advanceRound.bind(null, jobId, appId), undefined);

  // Rejecting is the ONE move that can't be a single click any more: since M12 it must carry a
  // structured reason, so the button reveals a small form instead of firing. Every other move is
  // unchanged — the friction is added exactly where the data requirement is, and nowhere else.
  const [rejecting, setRejecting] = useState(false);
  const error = moveState?.error || roundState?.error;

  if (rejecting) {
    return (
      <form action={moveAction} className="mt-2 flex flex-col gap-1.5">
        <input type="hidden" name="toStage" value="REJECTED" />
        <label className="text-xs font-medium" htmlFor={`reason-${appId}`}>
          {labels.reasonLabel}
        </label>
        <select
          id={`reason-${appId}`}
          name="rejectionCategory"
          required
          defaultValue=""
          className="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        >
          <option value="" disabled>
            —
          </option>
          {rejectionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          <button type="submit" disabled={movePending} className={`${BTN} ${TONE.danger}`}>
            {labels.confirm}
          </button>
          <button type="button" onClick={() => setRejecting(false)} className={`${BTN} ${TONE.muted}`}>
            {labels.cancel}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {buttons.map((b, i) =>
          b.kind === "reject" ? (
            <button
              key={i}
              type="button"
              onClick={() => setRejecting(true)}
              className={`${BTN} ${TONE[b.tone] ?? TONE.muted}`}
            >
              {b.label}
            </button>
          ) : b.kind === "round" ? (
            <form key={i} action={roundAction}>
              <button type="submit" disabled={roundPending} className={`${BTN} ${TONE[b.tone] ?? TONE.muted}`}>
                {b.label}
              </button>
            </form>
          ) : (
            <form key={i} action={moveAction}>
              <input type="hidden" name="toStage" value={b.toStage} />
              <button type="submit" disabled={movePending} className={`${BTN} ${TONE[b.tone] ?? TONE.muted}`}>
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
