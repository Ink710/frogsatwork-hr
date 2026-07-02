"use client";

import { useActionState } from "react";
import { correctIdentity, correctMaterial } from "@/app/employees/[id]/actions";

const TYPES = [
  ["FULL_TIME", "Full time"],
  ["PART_TIME", "Part time"],
  ["CONTRACT", "Contract"],
  ["INTERN", "Intern"],
];
const field = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

export function CorrectForms({ employeeId, employee, current, withinWindow, windowDays, departments, managerOptions, canEditComp }) {
  const identityAction = correctIdentity.bind(null, employeeId);
  const materialAction = correctMaterial.bind(null, employeeId);
  const [idState, idForm, idPending] = useActionState(identityAction, {});
  const [mtState, mtForm, mtPending] = useActionState(materialAction, {});

  return (
    <div className="mt-6 space-y-10">
      {/* Identity — always correctable */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Identity</h2>
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
          <button type="submit" disabled={idPending} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
            {idPending ? "Saving…" : "Save identity correction"}
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
              <div>
                <label className={label} htmlFor="employmentType">Employment type</label>
                <select id="employmentType" name="employmentType" defaultValue={current?.employmentType ?? "FULL_TIME"} className={field}>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
                <div>
                  <label className={label} htmlFor="salary">Salary</label>
                  <input id="salary" name="salary" defaultValue={current?.salary ?? ""} inputMode="decimal" className={field} />
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
