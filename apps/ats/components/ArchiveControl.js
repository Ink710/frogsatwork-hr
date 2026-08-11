"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { archiveCandidate, restoreCandidate } from "@/app/(internal)/candidates/archive";

// Archive / restore on the candidate profile. Deliberately understated compared with the erase
// control: no typed confirmation, no warning panel, no red. The visual weight of a control should
// match how hard it is to undo, and this one is undone by pressing the other button.
export function ArchiveControl({ candidateId, archived }) {
  const t = useT();
  const action = archived ? restoreCandidate : archiveCandidate;
  const [state, formAction, pending] = useActionState(
    async () => action(candidateId),
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
      >
        {pending
          ? t(archived ? "archive.restoring" : "archive.archiving")
          : t(archived ? "archive.restore" : "archive.archive")}
      </button>
      <p className="text-xs text-muted-foreground">
        {t(archived ? "archive.restoreHint" : "archive.archiveHint")}
      </p>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
