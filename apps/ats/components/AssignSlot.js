"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { formatSlotWhen } from "@hris/recruiting";
import { assignSlot } from "@/app/(internal)/jobs/actions";

/**
 * Book a published interview time for this application (M9).
 *
 * ⚠️ The list here can be STALE by the time it is submitted — the pool is shared, so another
 * recruiter may have taken the slot between this page rendering and the click. That is not defended
 * against by re-reading: `app_claim_interview_slot` is a single conditional UPDATE, and losing the
 * race simply returns UNAVAILABLE, which becomes the message below. Choosing again is the fix.
 */
export function AssignSlot({ jobId, appId, slots, booked, locale }) {
  const t = useT();
  const [state, action, pending] = useActionState(assignSlot.bind(null, jobId, appId), undefined);

  if (booked) {
    return (
      <p className="text-sm">
        {t("slots.booked", { when: formatSlotWhen(booked, locale) })}
        {booked.meetingUrl && (
          <>
            {" · "}
            <a href={booked.meetingUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
              {booked.meetingUrl}
            </a>
          </>
        )}
      </p>
    );
  }

  if (slots.length === 0) return <p className="text-sm text-muted-foreground">{t("slots.assignNone")}</p>;

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("slots.assignTitle")}</span>
        <select
          name="slotId"
          required
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        >
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {formatSlotWhen(s, locale)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {t("slots.assign")}
      </button>
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
