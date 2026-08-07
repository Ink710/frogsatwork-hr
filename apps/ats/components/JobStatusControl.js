"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { setJobStatus } from "@/app/(internal)/jobs/actions";

// Move a posting through its lifecycle. There is deliberately no "delete" — a requisition is never
// removed; CLOSED / FILLED are the archive states, so its pipeline and history survive.
export function JobStatusControl({ jobId, status, statuses }) {
  const t = useT();
  const [state, action, pending] = useActionState(setJobStatus.bind(null, jobId), undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted-foreground" htmlFor="status">
        {t("jobForm.status")}
      </label>
      <select
        id="status"
        name="status"
        defaultValue={status}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      >
        {statuses.map((s) => (
          <option key={s} value={s}>
            {t(`enum.jobStatus.${s}`)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        {t("jobForm.setStatus")}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
