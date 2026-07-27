"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { createMeeting, updateMeeting } from "@/app/meetings/actions";

const field =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// Weekday options in Mon-first display order; values are the getUTCDay numbers stored on the meeting.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Create (no meeting) or edit (meeting passed) a recurring meeting. Managers/HR only; server re-checks.
export function MeetingForm({ meeting }) {
  const t = useT();
  const action = meeting ? updateMeeting.bind(null, meeting.id) : createMeeting;
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">{t("meetings.form.name")}</label>
        <input id="name" name="name" defaultValue={meeting?.name ?? ""} required maxLength={120} placeholder={t("meetings.form.namePlaceholder")} className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="dayOfWeek" className="block text-sm font-medium">{t("meetings.form.day")}</label>
          <select id="dayOfWeek" name="dayOfWeek" defaultValue={String(meeting?.dayOfWeek ?? 1)} className={field}>
            {WEEKDAY_ORDER.map((d) => (
              <option key={d} value={d}>{t(`enum.dayOfWeek.${d}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="startTime" className="block text-sm font-medium">{t("meetings.form.start")}</label>
          <input id="startTime" name="startTime" type="time" required defaultValue={meeting?.startTime ?? "09:00"} className={field} />
        </div>
        <div>
          <label htmlFor="endTime" className="block text-sm font-medium">{t("meetings.form.end")}</label>
          <input id="endTime" name="endTime" type="time" required defaultValue={meeting?.endTime ?? "09:30"} className={field} />
        </div>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {meeting ? t("meetings.form.save") : t("meetings.form.create")}
      </button>
    </form>
  );
}
