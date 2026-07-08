"use client";

import { useActionState } from "react";
import { recordChange } from "@/app/employees/[id]/actions";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  FLSA_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  PAY_BASIS_OPTIONS,
} from "@/lib/enums";

const field = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

export function EditChangeForm({ employeeId, employee, current, departments, managerOptions, canEditComp }) {
  const action = recordChange.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {state.error}
        </p>
      )}

      <div>
        <label className={label} htmlFor="jobTitle">Job title</label>
        <input id="jobTitle" name="jobTitle" defaultValue={current?.jobTitle ?? ""} required className={field} />
      </div>

      <div>
        <label className={label} htmlFor="employmentType">Employment type</label>
        <select id="employmentType" name="employmentType" defaultValue={current?.employmentType ?? "FULL_TIME"} className={field}>
          {EMPLOYMENT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="flsaClassification">FLSA classification</label>
          <select id="flsaClassification" name="flsaClassification" defaultValue={current?.flsaClassification ?? "EXEMPT"} className={field}>
            {FLSA_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="payFrequency">Pay frequency</label>
          <select id="payFrequency" name="payFrequency" defaultValue={current?.payFrequency ?? "SEMI_MONTHLY"} className={field}>
            {PAY_FREQUENCY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
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
            <input id="salary" name="salary" defaultValue={current?.salary ?? ""} inputMode="decimal"
                   placeholder="e.g. 120000" className={field} />
            <input type="hidden" name="currency" value={current?.currency ?? "USD"} />
          </div>
          <div>
            <label className={label} htmlFor="payBasis">Pay basis</label>
            <select id="payBasis" name="payBasis" defaultValue={current?.payBasis ?? "PER_YEAR"} className={field}>
              {PAY_BASIS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor="effectiveFrom">Effective date</label>
        <input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} min={today} required className={field} />
        <p className="mt-1 text-xs text-zinc-400">Material changes can’t be backdated.</p>
      </div>

      <div>
        <label className={label} htmlFor="changeReason">Reason (optional)</label>
        <input id="changeReason" name="changeReason" placeholder="e.g. Promotion" className={field} />
      </div>

      <button type="submit" disabled={pending}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
        {pending ? "Recording…" : "Record change"}
      </button>
    </form>
  );
}
