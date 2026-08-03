"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useT, useLocale } from "@/components/LocaleProvider";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { createShifts } from "@/app/schedule/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const checkRow = "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer";

// Create MANY shifts in one submit: pick employees (+ optional Open) × weekdays of the shown week, with
// one start/end/role/note. Shortcuts tick a group of days additively (so you can then untick one). Warns
// (does not block) when a selected employee is on approved leave on a selected day. Submits createShifts.
export function BatchShiftForm({ employees = [], weekDays = [], onLeave = {} }) {
  const t = useT();
  const locale = INTL_LOCALE[useLocale()];
  const [state, action, pending] = useActionState(createShifts, undefined);

  const [emps, setEmps] = useState(() => new Set());
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(() => new Set());

  const toggleIn = (setter) => (val) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  const toggleEmp = toggleIn(setEmps);
  const toggleDay = toggleIn(setDays);
  // Additively tick every week date whose day-of-week is in `dows` (Mon–Fri = [1..5], Fri–Sun = [5,6,0]).
  const addDows = (dows) =>
    setDays((prev) => {
      const next = new Set(prev);
      for (const d of weekDays) if (dows.includes(d.dow)) next.add(d.date);
      return next;
    });

  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const conflicts = useMemo(() => {
    const out = [];
    for (const empId of emps) {
      for (const day of days) {
        if (onLeave[empId]?.includes(day)) {
          const e = empById[empId];
          out.push({ name: e ? `${e.firstName} ${e.lastName}` : empId, date: day });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [emps, days, onLeave, empById]);

  const count = (emps.size + (open ? 1 : 0)) * days.size;
  const nothing = (emps.size === 0 && !open) || days.size === 0;

  return (
    <form action={action} className="space-y-6">
      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

      {/* Employees */}
      <fieldset>
        <legend className="text-sm font-medium">{t("schedule.batch.employees")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {employees.map((e) => (
            <label key={e.id} className={checkRow}>
              <input type="checkbox" name="employeeIds" value={e.id} checked={emps.has(e.id)} onChange={() => toggleEmp(e.id)} />
              <span>
                {e.firstName} {e.lastName} <span className="font-mono text-xs text-muted-foreground">({e.employeeNumber})</span>
              </span>
            </label>
          ))}
          <label className={checkRow}>
            <input type="checkbox" name="open" checked={open} onChange={() => setOpen((v) => !v)} />
            <span>{t("schedule.batch.openShift")}</span>
          </label>
        </div>
      </fieldset>

      {/* Days */}
      <fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-medium">{t("schedule.batch.days")}</legend>
          <div className="flex gap-1">
            <button type="button" onClick={() => addDows([1, 2, 3, 4, 5])} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
              {t("schedule.batch.workdays")}
            </button>
            <button type="button" onClick={() => addDows([5, 6, 0])} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
              {t("schedule.batch.weekend")}
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {weekDays.map((d) => (
            <label key={d.date} className={checkRow}>
              <input type="checkbox" name="days" value={d.date} checked={days.has(d.date)} onChange={() => toggleDay(d.date)} />
              <span>
                {t(`enum.dayOfWeek.${d.dow}`)} <span className="text-xs text-muted-foreground">{formatDate(d.date, locale)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Times + role + note */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="start" className="block text-sm font-medium">{t("schedule.form.start")}</label>
          <input id="start" name="start" type="time" required defaultValue="09:00" className={fieldCls} />
        </div>
        <div>
          <label htmlFor="end" className="block text-sm font-medium">{t("schedule.form.end")}</label>
          <input id="end" name="end" type="time" required defaultValue="17:00" className={fieldCls} />
        </div>
      </div>
      <div>
        <label htmlFor="role" className="block text-sm font-medium">{t("schedule.form.role")}</label>
        <input id="role" name="role" placeholder={t("schedule.form.rolePlaceholder")} className={fieldCls} />
      </div>
      <div>
        <label htmlFor="note" className="block text-sm font-medium">{t("schedule.form.note")}</label>
        <input id="note" name="note" className={fieldCls} />
      </div>

      {/* Leave warning — advisory, does not block creation. */}
      {conflicts.length > 0 && (
        <div className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("schedule.batch.leaveWarningTitle")}
          </p>
          <ul className="mt-1 list-disc pl-6">
            {conflicts.map((c, i) => (
              <li key={i}>{t("schedule.batch.leaveWarning", { name: c.name, date: formatDate(c.date, locale) })}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={pending || nothing}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {count > 0 ? t("schedule.batch.createCount", { count: String(count) }) : t("schedule.batch.create")}
      </button>
    </form>
  );
}
