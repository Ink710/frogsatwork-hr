"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useT } from "@hris/ui/client";
import { formatSlotWhen } from "@hris/recruiting";
import { confirmSlot } from "@/app/(internal)/jobs/actions";

// One proposed slot awaiting the signed-in interviewer's confirmation.
//
// The confirm action carries no role check of its own: app_can_confirm_interview_slot decides, and
// it checks BOTH that the caller is the assigned interviewer AND that the slot is still waiting.
// The list is already scoped to this person, so a refusal here means the state changed underneath —
// which is exactly what the message says.
function QueueRow({ slot, locale }) {
  const t = useT();
  const [state, action, pending] = useActionState(confirmSlot.bind(null, slot.jobId, slot.id), undefined);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Canonical rendering: always names its zone, because an interviewer may well be in a
              different one from the recruiter who proposed the time. */}
          <p className="text-sm font-medium">{formatSlotWhen(slot, locale)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Link href={`/jobs/${slot.jobId}`} className="hover:underline">
              {slot.jobTitle}
            </Link>
            {" · "}
            {slot.roundName}
          </p>
        </div>
        <form action={action}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {t("slots.confirm")}
          </button>
        </form>
      </div>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </li>
  );
}

export function ConfirmationQueue({ slots, locale }) {
  const t = useT();
  if (slots.length === 0) return <p className="text-sm text-muted-foreground">{t("slots.queueEmpty")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {slots.map((s) => (
        <QueueRow key={s.id} slot={s} locale={locale} />
      ))}
    </ul>
  );
}
