"use client";

import { useState } from "react";
import { MAX_HISTORY_ENTRIES } from "@hris/recruiting";

// The repeatable work-history and education editors, shared by the two forms that collect them:
// the public apply form (M6) and the profile editor (M7).
//
// Extracted rather than copied because the two are the SAME editor over the same Zod schemas — a
// validation message or a field rename has one home. What is deliberately NOT in here is anything
// either form owns alone: section headings, the honeypot, consent, EEO, screening questions. Those
// differ, and pushing them behind a prop is how a shared component turns into a switch statement.
//
// ⚠️ The i18n keys keep their `apply.` prefix even though a profile page renders them now. They are
// the same UI copy ("Employer", "Start month"), and renaming ten keys across two dictionaries would
// mean editing the highest-traffic public form in the app for no user-visible change.

export const INPUT =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
export const LABEL = "text-sm font-medium";

export const emptyJob = { employer: "", title: "", startDate: "", endDate: "", summary: "" };
export const emptyStudy = { institution: "", qualification: "", startDate: "", endDate: "" };

// Repeatable rows kept in React state and posted as ONE JSON field.
//
// The alternative — naming inputs `employer[0]`, `employer[1]` … — needs the client and the server
// to agree on an encoding that HTML gives no help with, and it breaks the moment a row is removed
// from the middle. One JSON field has one shape, and the server parses it with the same Zod schema
// the tests use.
export function useRows(initial, blank) {
  const [rows, setRows] = useState(initial.length ? initial : []);
  return {
    rows,
    add: () => setRows((r) => (r.length >= MAX_HISTORY_ENTRIES ? r : [...r, { ...blank }])),
    remove: (i) => setRows((r) => r.filter((_, n) => n !== i)),
    update: (i, field, value) =>
      setRows((r) => r.map((row, n) => (n === i ? { ...row, [field]: value } : row))),
  };
}

export function EmploymentRows({ jobs, t }) {
  return (
    <>
      <ul className="mt-3 flex flex-col gap-3">
        {jobs.rows.map((row, i) => (
          <li key={i} className="rounded-lg border border-border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                aria-label={t("apply.employer")} placeholder={t("apply.employer")} value={row.employer}
                onChange={(e) => jobs.update(i, "employer", e.target.value)} className={INPUT}
              />
              <input
                aria-label={t("apply.jobTitle")} placeholder={t("apply.jobTitle")} value={row.title}
                onChange={(e) => jobs.update(i, "title", e.target.value)} className={INPUT}
              />
              {/* type=month gives a real picker and posts exactly the YYYY-MM the schema wants. */}
              <input
                aria-label={t("apply.startMonth")} type="month" value={row.startDate}
                onChange={(e) => jobs.update(i, "startDate", e.target.value)} className={INPUT}
              />
              <input
                aria-label={t("apply.endMonth")} type="month" value={row.endDate}
                onChange={(e) => jobs.update(i, "endDate", e.target.value)} className={INPUT}
              />
            </div>
            <textarea
              aria-label={t("apply.summary")} placeholder={t("apply.summary")} rows={2} value={row.summary}
              onChange={(e) => jobs.update(i, "summary", e.target.value)} className={`${INPUT} mt-3`}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t("apply.leaveEndBlank")}</span>
              <button type="button" onClick={() => jobs.remove(i)} className="text-xs text-destructive hover:underline">
                {t("apply.remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button" onClick={jobs.add} disabled={jobs.rows.length >= MAX_HISTORY_ENTRIES}
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
      >
        {t("apply.addRole")}
      </button>
    </>
  );
}

export function EducationRows({ studies, t }) {
  return (
    <>
      <ul className="mt-3 flex flex-col gap-3">
        {studies.rows.map((row, i) => (
          <li key={i} className="rounded-lg border border-border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                aria-label={t("apply.institution")} placeholder={t("apply.institution")} value={row.institution}
                onChange={(e) => studies.update(i, "institution", e.target.value)} className={INPUT}
              />
              <input
                aria-label={t("apply.qualification")} placeholder={t("apply.qualification")} value={row.qualification}
                onChange={(e) => studies.update(i, "qualification", e.target.value)} className={INPUT}
              />
              <input
                aria-label={t("apply.startMonth")} type="month" value={row.startDate}
                onChange={(e) => studies.update(i, "startDate", e.target.value)} className={INPUT}
              />
              <input
                aria-label={t("apply.endMonth")} type="month" value={row.endDate}
                onChange={(e) => studies.update(i, "endDate", e.target.value)} className={INPUT}
              />
            </div>
            <div className="mt-2 text-right">
              <button type="button" onClick={() => studies.remove(i)} className="text-xs text-destructive hover:underline">
                {t("apply.remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button" onClick={studies.add} disabled={studies.rows.length >= MAX_HISTORY_ENTRIES}
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
      >
        {t("apply.addStudy")}
      </button>
    </>
  );
}
