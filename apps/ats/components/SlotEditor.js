"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import {
  formatSlotWhen,
  slotStatus,
  canPublish,
  canCancel,
  SLOT_DURATIONS,
  SCHEDULING_ZONES,
} from "@hris/recruiting";
import { proposeSlot, publishSlot, cancelSlot } from "@/app/(internal)/jobs/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const LABEL = "text-xs font-medium text-muted-foreground";


const BADGE = {
  PROPOSED: "bg-muted text-muted-foreground",
  CONFIRMED: "bg-primary/10 text-primary",
  PUBLISHED: "bg-primary/20 text-primary",
  CLAIMED: "bg-primary text-primary-foreground",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

function SlotRow({ jobId, slot, locale }) {
  const t = useT();
  const [publishState, publishAction, publishing] = useActionState(publishSlot.bind(null, jobId, slot.id), undefined);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelSlot.bind(null, jobId, slot.id), undefined);
  const error = publishState?.error || cancelState?.error;

  const status = slotStatus(slot);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* The canonical rendering — always naming its zone. See formatSlotWhen. */}
          <p className="text-sm font-medium">{formatSlotWhen(slot, locale)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {slot.roundName} · {slot.interviewerName}
          </p>
          {slot.takenByName && (
            <p className="mt-0.5 text-xs text-primary">{t("slots.takenBy", { name: slot.takenByName })}</p>
          )}
          {status === "PROPOSED" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("slots.awaitingConfirmation", { name: slot.interviewerName })}
            </p>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}>
          {t(`enum.slotStatus.${status}`)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* ⚠️ NO CONFIRM BUTTON HERE, and that is structural rather than cosmetic. This editor lives
            on /jobs/[id]/manage, which 404s for anyone who cannot MANAGE the req — so the assigned
            interviewer (a JobMember with role INTERVIEWER) can never reach this page at all.
            Confirming happens in their own queue at /interviews, which is why decision 3 needed an
            in-app surface and not just an email. */}
        {canPublish(slot) && (
          <form action={publishAction}>
            <button type="submit" disabled={publishing} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60">
              {t("slots.publish")}
            </button>
          </form>
        )}
        {canCancel(slot) && (
          <form action={cancelAction}>
            <button type="submit" disabled={cancelling} className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60">
              {t("slots.cancel")}
            </button>
          </form>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function SlotEditor({ jobId, slots, rounds, members, defaultZone, locale }) {
  const t = useT();
  const [state, action, pending] = useActionState(proposeSlot.bind(null, jobId), undefined);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t("slots.hint")}</p>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("slots.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((s) => (
            <SlotRow key={s.id} jobId={jobId} slot={s} locale={locale} />
          ))}
        </ul>
      )}

      <form action={action} className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.round")}</span>
          <select name="roundId" required className={INPUT}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.interviewer")}</span>
          <select name="interviewerEmployeeId" required className={INPUT}>
            {members.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>{m.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.startsAt")}</span>
          {/* datetime-local gives a WALL CLOCK with no zone. It is interpreted against the zone
              selected beside it, server-side — never with new Date(), which would use the server's. */}
          <input name="startsAt" type="datetime-local" required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.timeZone")}</span>
          <select name="timeZone" defaultValue={defaultZone} required className={INPUT}>
            {SCHEDULING_ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.duration")}</span>
          <select name="durationMinutes" defaultValue={60} className={INPUT}>
            {SLOT_DURATIONS.map((n) => (
              <option key={n} value={n}>{t("slots.minutes", { n })}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("slots.meetingUrl")}</span>
          <input name="meetingUrl" type="url" placeholder="https://…" className={INPUT} />
        </label>

        <div className="sm:col-span-2">
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {pending ? t("slots.proposing") : t("slots.propose")}
          </button>
          {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
        </div>
      </form>
    </div>
  );
}
