"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { createShift, updateShift } from "@/app/schedule/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function Label({ htmlFor, children }) {
  return <label htmlFor={htmlFor} className="block text-sm font-medium">{children}</label>;
}

// Create or edit one shift. `shiftId` present → edit (updateShift); otherwise create.
export function ShiftForm({ employees = [], initial = null, shiftId = null, defaultDate = "" }) {
  const t = useT();
  const boundAction = shiftId ? updateShift.bind(null, shiftId) : createShift;
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

      <div>
        <Label htmlFor="employeeId">{t("schedule.form.employee")}</Label>
        <select id="employeeId" name="employeeId" defaultValue={initial?.employeeId ?? ""} className={fieldCls}>
          <option value="">{t("schedule.form.open")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName} ({e.employeeNumber})
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="date">{t("schedule.form.date")}</Label>
        <input id="date" name="date" type="date" required defaultValue={initial?.date ?? defaultDate} className={fieldCls} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="start">{t("schedule.form.start")}</Label>
          <input id="start" name="start" type="time" required defaultValue={initial?.start ?? "09:00"} className={fieldCls} />
        </div>
        <div>
          <Label htmlFor="end">{t("schedule.form.end")}</Label>
          <input id="end" name="end" type="time" required defaultValue={initial?.end ?? "17:00"} className={fieldCls} />
        </div>
      </div>

      <div>
        <Label htmlFor="role">{t("schedule.form.role")}</Label>
        <input id="role" name="role" defaultValue={initial?.role ?? ""} placeholder={t("schedule.form.rolePlaceholder")} className={fieldCls} />
      </div>

      <div>
        <Label htmlFor="note">{t("schedule.form.note")}</Label>
        <input id="note" name="note" defaultValue={initial?.note ?? ""} className={fieldCls} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {shiftId ? t("schedule.form.save") : t("schedule.form.create")}
      </button>
    </form>
  );
}
