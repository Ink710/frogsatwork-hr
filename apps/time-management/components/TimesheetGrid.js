"use client";

import { useActionState, useState } from "react";
import { computeTimesheet, formatHours } from "@hris/workable-hours";
import { useT, useLocale } from "@/components/LocaleProvider";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { saveOrSubmitTimesheet } from "@/app/timesheets/actions";

// The 7 "YYYY-MM-DD" days (Mon–Sun) of a week, from its Monday.
function weekDays(startStr) {
  const days = [];
  const d = new Date(`${startStr}T00:00:00.000Z`);
  for (let i = 0; i < 7; i++) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

const cellInput =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60";

// The weekly grid. Overtime is computed live with the SAME pure rule the server uses, so what the
// employee sees matches what's stored. One <form>, two submit buttons (Save draft / Submit) routed
// through saveOrSubmitTimesheet via useActionState so errors surface inline.
// `mode`: "self" = the employee's own grid (Save draft / Submit). "adjust" = a manager editing a
// report's submitted sheet (a single Save-adjustments button); pass the bound `action` for that.
export function TimesheetGrid({ week, initialEntries, flsa, editable, projects = [], mode = "self", action: injectedAction }) {
  const t = useT();
  const locale = INTL_LOCALE[useLocale()];
  const [state, action, pending] = useActionState(injectedAction ?? saveOrSubmitTimesheet.bind(null, week.start), undefined);

  const [rows, setRows] = useState(() => {
    const m = {};
    for (const e of initialEntries) m[e.workDate] = { hours: String(e.hours), projectId: e.projectId ?? "", note: e.note ?? "" };
    return m;
  });

  const days = weekDays(week.start);
  const entries = days.map((d) => ({
    workDate: d,
    hours: Number(rows[d]?.hours || 0),
    projectId: rows[d]?.projectId || undefined,
    note: rows[d]?.note || undefined,
  }));
  // Cheap pure computation — fine to run each render (no memo needed).
  const hours = computeTimesheet(entries, flsa);
  const entriesJson = JSON.stringify(entries.filter((e) => e.hours > 0));

  const setDay = (date, field, value) => setRows((r) => ({ ...r, [date]: { ...r[date], [field]: value } }));

  return (
    <form action={action} className="mt-4 space-y-4">
      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <input type="hidden" name="entries" value={entriesJson} />

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] font-table text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("timesheets.day")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.hours")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.project")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.note")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
              const weekend = dow === 0 || dow === 6;
              return (
                <tr key={d} className={`border-b border-border/60 last:border-0 ${weekend ? "bg-muted/30" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(d, locale)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number" step="0.5" min="0" max="24" inputMode="decimal"
                      disabled={!editable}
                      value={rows[d]?.hours ?? ""}
                      onChange={(e) => setDay(d, "hours", e.target.value)}
                      className={`${cellInput} w-24 font-mono tabular-nums`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      disabled={!editable || projects.length === 0}
                      value={rows[d]?.projectId ?? ""}
                      onChange={(e) => setDay(d, "projectId", e.target.value)}
                      className={cellInput}
                    >
                      <option value="">{t("timesheets.noProject")}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input disabled={!editable} value={rows[d]?.note ?? ""} onChange={(e) => setDay(d, "note", e.target.value)} className={cellInput} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>{t("timesheets.totalLabel")}: <span className="font-semibold font-mono tabular-nums">{formatHours(hours.total)}</span></span>
        <span className="text-muted-foreground">{t("timesheets.regularLabel")}: <span className="font-mono tabular-nums">{formatHours(hours.regular)}</span></span>
        {hours.overtime > 0 && (
          <span className="text-warning">{t("timesheets.otLabel")}: <span className="font-mono tabular-nums">{formatHours(hours.overtime)}</span></span>
        )}
        {hours.doubletime > 0 && (
          <span className="text-destructive">{t("timesheets.dtLabel")}: <span className="font-mono tabular-nums">{formatHours(hours.doubletime)}</span></span>
        )}
      </div>

      {editable ? (
        mode === "adjust" ? (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {t("myTeam.saveAdjustments")}
            </button>
            {state?.ok && <span className="text-sm text-success">{t("myTeam.adjusted")}</span>}
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="submit" name="intent" value="save" disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60">
              {t("timesheets.saveDraft")}
            </button>
            <button type="submit" name="intent" value="submit" disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {t("timesheets.submit")}
            </button>
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("timesheets.locked")}</p>
      )}
    </form>
  );
}
