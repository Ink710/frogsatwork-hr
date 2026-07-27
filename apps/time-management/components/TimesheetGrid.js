"use client";

import { Fragment, useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
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

let lineSeq = 0;
const nextKey = () => `l${lineSeq++}`;

// The weekly grid, as LINE-ITEMS: a day can hold several lines, each tagged a project OR a recurring
// meeting (or neither). Assigned meetings pre-fill a suggested line (their duration) on their weekday
// — the hybrid feature. Overtime is computed live with the SAME pure rule the server uses (it groups
// by day and sums, so multiple lines per day are handled), so what the employee sees matches storage.
// One <form>, two submit buttons (Save draft / Submit) via useActionState so errors surface inline.
// `mode`: "self" = the employee's own grid (Save draft / Submit; meetings pre-fill). "adjust" = a
// manager editing a report's submitted sheet (single Save-adjustments button, no auto pre-fill).
export function TimesheetGrid({ week, initialEntries, flsa, editable, projects = [], meetings = [], suggestions = [], mode = "self", action: injectedAction }) {
  const t = useT();
  const locale = INTL_LOCALE[useLocale()];
  const [state, action, pending] = useActionState(injectedAction ?? saveOrSubmitTimesheet.bind(null, week.start), undefined);

  const [lines, setLines] = useState(() => {
    const seeded = initialEntries.map((e) => ({
      key: nextKey(),
      workDate: e.workDate,
      hours: String(e.hours),
      projectId: e.projectId ?? "",
      meetingId: e.meetingId ?? "",
      note: e.note ?? "",
    }));
    // Pre-fill an assigned meeting's suggested line on its weekday — unless the employee already has a
    // saved line for that meeting on that day. Only on the employee's own editable grid (not adjust).
    if (mode === "self" && editable) {
      for (const s of suggestions) {
        const already = seeded.some((l) => l.meetingId === s.meetingId && l.workDate === s.workDate);
        if (!already) {
          seeded.push({ key: nextKey(), workDate: s.workDate, hours: String(s.suggestedHours), projectId: "", meetingId: s.meetingId, note: "" });
        }
      }
    }
    return seeded;
  });

  const days = weekDays(week.start);
  const entries = lines.map((l) => ({ workDate: l.workDate, hours: Number(l.hours || 0) }));
  // Cheap pure computation — fine to run each render (no memo needed). Sums per day across lines.
  const hours = computeTimesheet(entries, flsa);
  const entriesJson = JSON.stringify(
    lines
      .filter((l) => Number(l.hours) > 0)
      .map((l) => ({
        workDate: l.workDate,
        hours: Number(l.hours),
        projectId: l.projectId || undefined,
        meetingId: l.meetingId || undefined,
        note: l.note || undefined,
      })),
  );

  const setField = (key, field, value) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  // One <select> spans projects + meetings; the value encodes which ("p:id" / "m:id" / "").
  const activityValue = (l) => (l.meetingId ? `m:${l.meetingId}` : l.projectId ? `p:${l.projectId}` : "");
  const setActivity = (key, val) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === key ? { ...l, projectId: val.startsWith("p:") ? val.slice(2) : "", meetingId: val.startsWith("m:") ? val.slice(2) : "" } : l,
      ),
    );
  const addLine = (workDate) => setLines((ls) => [...ls, { key: nextKey(), workDate, hours: "", projectId: "", meetingId: "", note: "" }]);
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  const noActivities = projects.length === 0 && meetings.length === 0;
  const addBtn =
    "inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <form action={action} className="mt-4 space-y-4">
      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <input type="hidden" name="entries" value={entriesJson} />

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] font-table text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("timesheets.day")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.hours")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.activity")}</th>
              <th className="px-3 py-2 font-medium">{t("timesheets.note")}</th>
              <th className="px-3 py-2 font-medium sr-only">{t("timesheets.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
              const weekend = dow === 0 || dow === 6;
              const dayLines = lines.filter((l) => l.workDate === d);
              const rowCls = `border-b border-border/60 ${weekend ? "bg-muted/30" : ""}`;
              return (
                <Fragment key={d}>
                  {dayLines.map((line, i) => (
                    <tr key={line.key} className={rowCls}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{i === 0 ? formatDate(d, locale) : ""}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.5" min="0" max="24" inputMode="decimal"
                          disabled={!editable}
                          value={line.hours}
                          onChange={(e) => setField(line.key, "hours", e.target.value)}
                          className={`${cellInput} w-24 font-mono tabular-nums`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          disabled={!editable || noActivities}
                          value={activityValue(line)}
                          onChange={(e) => setActivity(line.key, e.target.value)}
                          className={cellInput}
                        >
                          <option value="">{t("timesheets.noActivity")}</option>
                          {projects.length > 0 && (
                            <optgroup label={t("timesheets.projectsGroup")}>
                              {projects.map((p) => (
                                <option key={p.id} value={`p:${p.id}`}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
                              ))}
                            </optgroup>
                          )}
                          {meetings.length > 0 && (
                            <optgroup label={t("timesheets.meetingsGroup")}>
                              {meetings.map((m) => (
                                <option key={m.id} value={`m:${m.id}`}>{m.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input disabled={!editable} value={line.note} onChange={(e) => setField(line.key, "note", e.target.value)} className={cellInput} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editable && (
                          <button type="button" aria-label={t("timesheets.removeLine")} onClick={() => removeLine(line.key)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {editable ? (
                    <tr className={rowCls}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{dayLines.length === 0 ? formatDate(d, locale) : ""}</td>
                      <td colSpan={4} className="px-3 py-2">
                        <button type="button" onClick={() => addLine(d)} className={addBtn}>
                          <Plus className="h-3.5 w-3.5" /> {t("timesheets.addLine")}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    dayLines.length === 0 && (
                      <tr className={rowCls}>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(d, locale)}</td>
                        <td colSpan={4} className="px-3 py-2 text-muted-foreground">—</td>
                      </tr>
                    )
                  )}
                </Fragment>
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
