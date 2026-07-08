"use client";

import { useActionState } from "react";
import { createEmployee } from "@/app/employees/[id]/actions";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  FLSA_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  PAY_BASIS_OPTIONS,
  ROLE_OPTIONS,
} from "@/lib/enums";

const field = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

export function CreateEmployeeForm({ departments, managerOptions, canEditComp }) {
  const [state, formAction, pending] = useActionState(createEmployee, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">{state.error}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" required className={field} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className={field} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="hireDate">Hire date</label>
          <input id="hireDate" name="hireDate" type="date" defaultValue={today} required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="employmentType">Employment type</label>
          <select id="employmentType" name="employmentType" defaultValue="FULL_TIME" className={field}>
            {EMPLOYMENT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="jobTitle">Job title</label>
        <input id="jobTitle" name="jobTitle" required className={field} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="departmentId">Department</label>
          <select id="departmentId" name="departmentId" required className={field}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="managerId">Manager</label>
          <select id="managerId" name="managerId" defaultValue="" className={field}>
            <option value="">— None —</option>
            {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="flsaClassification">FLSA classification</label>
          <select id="flsaClassification" name="flsaClassification" defaultValue="EXEMPT" className={field}>
            {FLSA_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="payFrequency">Pay frequency</label>
          <select id="payFrequency" name="payFrequency" defaultValue="SEMI_MONTHLY" className={field}>
            {PAY_FREQUENCY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="role">System role</label>
          <select id="role" name="role" defaultValue="EMPLOYEE" className={field}>
            {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {canEditComp && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="salary">Salary</label>
              <input id="salary" name="salary" inputMode="decimal" placeholder="e.g. 90000" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="payBasis">Pay basis</label>
              <select id="payBasis" name="payBasis" defaultValue="PER_YEAR" className={field}>
                {PAY_BASIS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <fieldset className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Contact & schedule</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="phone">Phone</label>
            <input id="phone" name="phone" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="location">Location</label>
            <input id="location" name="location" placeholder="e.g. Austin, TX" className={field} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="workSchedule">Work schedule</label>
            <input id="workSchedule" name="workSchedule" placeholder="e.g. Mon–Fri, 09:00–18:00" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="timeZone">Time zone</label>
            <input id="timeZone" name="timeZone" placeholder="e.g. America/Chicago" className={field} />
          </div>
        </div>
      </fieldset>

      {canEditComp && (
        <fieldset className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">Compensation details (optional)</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="lastReviewDate">Last review</label>
              <input id="lastReviewDate" name="lastReviewDate" type="date" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nextReviewDate">Next review</label>
              <input id="nextReviewDate" name="nextReviewDate" type="date" className={field} />
            </div>
          </div>
          <div className="mt-4">
            <label className={label} htmlFor="equityNote">Equity vesting</label>
            <input id="equityNote" name="equityNote" placeholder="e.g. 4-yr cliff · yr 1" className={field} />
          </div>
        </fieldset>
      )}

      <fieldset className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Emergency contact (required)</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="emergencyContactName">Name</label>
            <input id="emergencyContactName" name="emergencyContactName" required className={field} />
          </div>
          <div>
            <label className={label} htmlFor="emergencyContactRelationship">Relationship</label>
            <input id="emergencyContactRelationship" name="emergencyContactRelationship" required className={field} />
          </div>
        </div>
        <div className="mt-4">
          <label className={label} htmlFor="emergencyContactPhone">Phone</label>
          <input id="emergencyContactPhone" name="emergencyContactPhone" required className={field} />
        </div>
      </fieldset>

      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create employee"}
      </button>
    </form>
  );
}
