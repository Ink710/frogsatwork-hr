"use client";

import { useActionState, useState } from "react";
import { LEAVE_TYPES, defaultLeaveHours, formatHours } from "@hris/workable-hours";
import { useT } from "@/components/LocaleProvider";
import { submitTimeOff } from "@/app/time-off/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function Label({ htmlFor, children }) {
  return <label htmlFor={htmlFor} className="block text-sm font-medium">{children}</label>;
}

// Client form: submits to the submitTimeOff server action via useActionState. Hours auto-fill from
// the date range (business days × 8h) until the user overrides them — computed with the SAME pure
// rule the server uses, so what you see is what gets saved. Overdraw is shown as a warning, not a
// block (matches the policy; the server never rejects on balance).
export function TimeOffRequestForm({ available = {}, employees = [] }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitTimeOff, undefined);

  const [type, setType] = useState("VACATION");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hours, setHours] = useState("");
  const [touchedHours, setTouchedHours] = useState(false);

  // Derived (no effect + setState, which the lint rules forbid): the suggested size of the range,
  // and the value the hours input shows until the user types their own.
  const suggested = start && end ? defaultLeaveHours(start, end) : 0;
  const hoursValue = touchedHours ? hours : suggested ? String(suggested) : "";
  const effectiveHours = Number(hoursValue) || 0;
  const avail = available[type] ?? 0;
  const overdraw = type !== "UNPAID" && effectiveHours > avail;

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      {employees.length > 0 && (
        <div>
          <Label htmlFor="employeeId">{t("timeOff.new.forEmployee")}</Label>
          <select id="employeeId" name="employeeId" defaultValue="" className={fieldCls}>
            <option value="">{t("timeOff.new.self")}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} ({e.employeeNumber})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <Label htmlFor="type">{t("timeOff.new.type")}</Label>
        <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={fieldCls}>
          {LEAVE_TYPES.map((lt) => (
            <option key={lt} value={lt}>{t(`enum.leaveType.${lt}`)}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startDate">{t("timeOff.new.start")}</Label>
          <input id="startDate" name="startDate" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={fieldCls} />
        </div>
        <div>
          <Label htmlFor="endDate">{t("timeOff.new.end")}</Label>
          <input id="endDate" name="endDate" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={fieldCls} />
        </div>
      </div>

      <div>
        <Label htmlFor="hours">{t("timeOff.new.hours")}</Label>
        <input
          id="hours"
          name="hours"
          type="number"
          min="0.5"
          step="0.5"
          required
          value={hoursValue}
          onChange={(e) => {
            setTouchedHours(true);
            setHours(e.target.value);
          }}
          className={fieldCls}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("timeOff.new.hoursHint")}</p>
        {overdraw && (
          <p className="mt-1 text-xs text-warning">
            {t("timeOff.new.overdrawWarning", { available: formatHours(avail) })}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="reason">{t("timeOff.new.reason")}</Label>
        <textarea id="reason" name="reason" rows={2} className={fieldCls} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {t("timeOff.new.submit")}
      </button>
    </form>
  );
}
