"use client";

import { useActionState } from "react";
import { correctDetails, correctMaterial } from "@/app/employees/[id]/actions";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  FLSA_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  PAY_BASIS_OPTIONS,
} from "@/lib/enums";

const field = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

// A stored Date → "YYYY-MM-DD" for a date input (UTC slice matches the stored calendar date).
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function CorrectForms({ employeeId, employee, current, withinWindow, windowDays, departments, managerOptions, canEditComp }) {
  const detailsAction = correctDetails.bind(null, employeeId);
  const materialAction = correctMaterial.bind(null, employeeId);
  const [idState, idForm, idPending] = useActionState(detailsAction, {});
  const [mtState, mtForm, mtPending] = useActionState(materialAction, {});

  return (
    <div className="mt-6 space-y-10">
      {/* Details — current-state, always correctable */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Details</h2>
        <p className="mt-1 text-xs text-zinc-400">Descriptive data — correctable anytime, timestamped in the audit log.</p>
        <form action={idForm} className="mt-4 space-y-4">
          {idState?.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">{idState.error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="firstName">First name</label>
              <input id="firstName" name="firstName" defaultValue={employee.firstName} required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="lastName">Last name</label>
              <input id="lastName" name="lastName" defaultValue={employee.lastName} required className={field} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={employee.email} required className={field} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={employee.phone ?? ""} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="location">Location</label>
              <input id="location" name="location" defaultValue={employee.location ?? ""} placeholder="e.g. Austin, TX" className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="workSchedule">Work schedule</label>
              <input id="workSchedule" name="workSchedule" defaultValue={employee.workSchedule ?? ""} placeholder="e.g. Mon–Fri, 09:00–18:00" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="timeZone">Time zone</label>
              <input id="timeZone" name="timeZone" defaultValue={employee.timeZone ?? ""} placeholder="e.g. America/Chicago" className={field} />
            </div>
          </div>

          {/* Comp-sensitive current-state — only rendered (and only accepted) for comp-editors. */}
          {canEditComp && (
            <div className="grid grid-cols-2 gap-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="col-span-2 text-xs font-medium text-zinc-500">Compensation details</p>
              <div>
                <label className={label} htmlFor="lastReviewDate">Last review</label>
                <input id="lastReviewDate" name="lastReviewDate" type="date" defaultValue={toDateInput(employee.lastReviewDate)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="nextReviewDate">Next review</label>
                <input id="nextReviewDate" name="nextReviewDate" type="date" defaultValue={toDateInput(employee.nextReviewDate)} className={field} />
              </div>
              <div className="col-span-2">
                <label className={label} htmlFor="equityNote">Equity vesting</label>
                <input id="equityNote" name="equityNote" defaultValue={employee.equityNote ?? ""} placeholder="e.g. 4-yr cliff · yr 1" className={field} />
              </div>
            </div>
          )}

          <button type="submit" disabled={idPending} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
            {idPending ? "Saving…" : "Save details correction"}
          </button>
        </form>
      </section>

      {/* Material — only within the grace window */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Current record (material)</h2>
        {withinWindow ? (
          <>
            <p className="mt-1 text-xs text-zinc-400">
              Within the {windowDays}-day correction window — fixes are amended in place (no new version).
            </p>
            <form action={mtForm} className="mt-4 space-y-4">
              {mtState?.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">{mtState.error}</p>}
              <div>
                <label className={label} htmlFor="jobTitle">Job title</label>
                <input id="jobTitle" name="jobTitle" defaultValue={current?.jobTitle ?? ""} className={field} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="employmentType">Employment type</label>
                  <select id="employmentType" name="employmentType" defaultValue={current?.employmentType ?? "FULL_TIME"} className={field}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="flsaClassification">FLSA classification</label>
                  <select id="flsaClassification" name="flsaClassification" defaultValue={current?.flsaClassification ?? "EXEMPT"} className={field}>
                    {FLSA_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label} htmlFor="payFrequency">Pay frequency</label>
                <select id="payFrequency" name="payFrequency" defaultValue={current?.payFrequency ?? "SEMI_MONTHLY"} className={field}>
                  {PAY_FREQUENCY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="departmentId">Department</label>
                <select id="departmentId" name="departmentId" defaultValue={employee.departmentId} className={field}>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="managerId">Manager</label>
                <select id="managerId" name="managerId" defaultValue={employee.managerId ?? ""} className={field}>
                  <option value="">— None —</option>
                  {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {canEditComp && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="salary">Salary</label>
                    <input id="salary" name="salary" defaultValue={current?.salary ?? ""} inputMode="decimal" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="payBasis">Pay basis</label>
                    <select id="payBasis" name="payBasis" defaultValue={current?.payBasis ?? "PER_YEAR"} className={field}>
                      {PAY_BASIS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <button type="submit" disabled={mtPending} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
                {mtPending ? "Saving…" : "Save correction"}
              </button>
            </form>
          </>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            The {windowDays}-day correction window has closed for the current record. To
            change title, pay, department, manager, or type now, record a forward-dated
            change instead.
          </p>
        )}
      </section>
    </div>
  );
}
