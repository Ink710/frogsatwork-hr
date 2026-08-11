"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { eraseCandidate, refuseErasureRequest } from "@/app/(internal)/compliance/actions";

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

/**
 * The erase control. Three friction points, all on purpose, because this is the only action in the
 * suite that destroys data:
 *   • a plainly-worded warning about what goes and what stays,
 *   • a required decision note (the audit trail lives on the candidate shell afterwards),
 *   • a typed confirmation word.
 *
 * `blocked` is passed when the candidate was hired. The button is not rendered at all in that case —
 * the database would refuse it anyway (app_erase_candidate returns HIRED), but letting someone click
 * through to a refusal teaches them nothing, whereas an up-front explanation teaches them the rule.
 */
export function EraseCandidateForm({ candidateId, blocked = false }) {
  const t = useT();
  const [state, action, pending] = useActionState(eraseCandidate.bind(null, candidateId), undefined);

  if (blocked) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        {t("compliance.hiredBlocked")}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-muted-foreground">
        {t("compliance.eraseWarning")}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium" htmlFor={`note-${candidateId}`}>
            {t("compliance.noteLabel")}
          </label>
          <input
            id={`note-${candidateId}`}
            name="note"
            placeholder={t("compliance.notePlaceholder")}
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-xs font-medium" htmlFor={`confirm-${candidateId}`}>
            {t("compliance.confirmLabel")}
          </label>
          <input id={`confirm-${candidateId}`} name="confirm" autoComplete="off" className={INPUT} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          {pending ? t("compliance.erasing") : t("compliance.erase")}
        </button>
        {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}

/** Refuse a request. The note is required — see refuseErasureRequest for why. */
export function RefuseErasureForm({ requestId }) {
  const t = useT();
  const [state, action, pending] = useActionState(
    refuseErasureRequest.bind(null, requestId),
    undefined,
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[14rem] flex-1">
        <label className="block text-xs font-medium" htmlFor={`refuse-${requestId}`}>
          {t("compliance.noteLabel")}
        </label>
        <input
          id={`refuse-${requestId}`}
          name="note"
          required
          placeholder={t("compliance.notePlaceholder")}
          className={INPUT}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
      >
        {t("compliance.refuse")}
      </button>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
