"use client";

import { useActionState } from "react";
import { reopenApplication } from "@/app/(internal)/jobs/actions";

// Reopen a withdrawn application. Rendered only on WITHDRAWN cards in the Closed list — a REJECTED
// card has no equivalent, on purpose.
//
// No confirmation here: this is the UNDO, and putting a speed bump on the recovery path would be
// backwards. The friction belongs on the destructive action, which now has it.
export function ReopenApplication({ jobId, appId, label }) {
  const [state, action, pending] = useActionState(
    async () => reopenApplication(jobId, appId),
    undefined,
  );

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
      >
        {label}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
