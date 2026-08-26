"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { formatSlotWhen } from "@hris/recruiting";
import { claimSlot } from "@/app/portal/schedule/actions";
import { useViewerZone } from "@/components/useViewerZone";

/**
 * Choose an interview time (M11).
 *
 * ⚠️ THE LIST IS ALLOWED TO BE STALE, and that is designed rather than tolerated. The pool is shared
 * between everyone at this round, so another candidate can take a time between this page rendering
 * and the click. Re-reading before submitting would not fix it — only narrow the window — so the
 * doorway settles it with one atomic UPDATE and the loser is TOLD ("that time was just taken"),
 * with the list re-rendering without it.
 *
 * ⚠️ THE ONCE-ONLY RULE IS STATED HERE, BEFORE THEY CHOOSE. Learning it from a refusal afterwards is
 * a much worse way to find out, and it is the reason the booked state shows a sentence rather than a
 * disabled picker.
 */
export function SlotPicker({ slots, locale }) {
  const t = useT();
  // ⚠️ Local time matters MORE here than after booking: this is the moment someone abroad is
  // comparing options, and comparing them in a zone that is not theirs is how the wrong one gets
  // chosen. Same treatment as the booked time — canonical first, local underneath.
  const zone = useViewerZone();
  const [state, action, pending] = useActionState(claimSlot, undefined);

  if (slots.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-sm font-medium">{t("schedule.title", { round: slots[0].roundName })}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("schedule.onceOnly")}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {slots.map((s) => (
          <li key={s.id}>
            <form action={action} className="flex flex-wrap items-center justify-between gap-2">
              <input type="hidden" name="slotId" value={s.id} />
              {/* Canonical rendering first: always names its zone, because we do not know theirs. */}
              <span className="text-sm">
                {formatSlotWhen(s, locale)}
                {zone && zone !== s.timeZone && (
                  <span className="block text-xs text-muted-foreground">
                    {t("schedule.localTime", { when: formatSlotWhen({ ...s, timeZone: zone }, locale) })}
                  </span>
                )}
              </span>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {pending ? t("schedule.booking") : t("schedule.choose")}
              </button>
            </form>
          </li>
        ))}
      </ul>

      {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
