"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { correctClock } from "@/app/attendance/actions";

// Manager/HR form to append a corrective punch for an employee (e.g. close a forgotten clock-out).
// employeeId is fixed (hidden); the server re-checks authorization (viewerCanApprove) regardless.
export function ClockCorrectionForm({ employeeId, defaultDate }) {
  const t = useT();
  const [state, action, pending] = useActionState(correctClock, undefined);

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="employeeId" value={employeeId} />

      <div>
        <label htmlFor="type" className="block text-sm font-medium">{t("attendance.correct.type")}</label>
        <select
          id="type"
          name="type"
          defaultValue="OUT"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="OUT">{t("attendance.correct.typeOut")}</option>
          <option value="IN">{t("attendance.correct.typeIn")}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="date" className="block text-sm font-medium">{t("attendance.correct.date")}</label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={defaultDate}
            required
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <div>
          <label htmlFor="time" className="block text-sm font-medium">{t("attendance.correct.time")}</label>
          <input
            id="time"
            name="time"
            type="time"
            required
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      <div>
        <label htmlFor="note" className="block text-sm font-medium">{t("attendance.correct.note")}</label>
        <input
          id="note"
          name="note"
          type="text"
          maxLength={300}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {t("attendance.correct.submit")}
      </button>
    </form>
  );
}
