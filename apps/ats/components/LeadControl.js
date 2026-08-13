"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { markLead, unmarkLead } from "@/app/(internal)/candidates/lead";

const INPUT =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// Mark / unmark a great lead. Understated on purpose, exactly like ArchiveControl: no confirmation,
// no red, no warning panel. The visual weight of a control should match how hard it is to undo, and
// this one is undone by pressing the other button.
export function LeadControl({ candidateId, marked, note, markedByName }) {
  const t = useT();
  const [markState, markAction, marking] = useActionState(markLead.bind(null, candidateId), undefined);
  const [unmarkState, unmarkAction, unmarking] = useActionState(
    async () => unmarkLead(candidateId),
    undefined,
  );
  const error = markState?.error || unmarkState?.error;

  if (marked) {
    return (
      <div className="flex flex-col gap-3">
        {note && <p className="text-sm">{note}</p>}
        <p className="text-xs text-muted-foreground">
          {markedByName ? t("lead.markedBy", { name: markedByName }) : t("lead.markedByUnknown")}
        </p>
        <form action={unmarkAction}>
          <button
            type="submit"
            disabled={unmarking}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {unmarking ? t("lead.unmarking") : t("lead.unmark")}
          </button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <form action={markAction} className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("lead.hint")}</p>
      <textarea
        name="note"
        rows={2}
        placeholder={t("lead.notePlaceholder")}
        aria-label={t("lead.note")}
        className={INPUT}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={marking}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          {marking ? t("lead.marking") : t("lead.mark")}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </form>
  );
}
