"use client";

import { useActionState } from "react";
import { createEmployee } from "@/app/employees/[id]/actions";

const TYPES = [
  ["FULL_TIME", "Full time"],
  ["PART_TIME", "Part time"],
  ["CONTRACT", "Contract"],
  ["INTERN", "Intern"],
];
const ROLES = [
  ["EMPLOYEE", "Employee"],
  ["MANAGER", "Manager"],
  ["HR_GENERALIST", "HR generalist"],
  ["HR_ADMIN", "HR admin"],
  ["PAYROLL_ADMIN", "Payroll admin"],
];

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
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
          <label className={label} htmlFor="role">System role</label>
          <select id="role" name="role" defaultValue="EMPLOYEE" className={field}>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {canEditComp && (
          <div>
            <label className={label} htmlFor="salary">Salary</label>
            <input id="salary" name="salary" inputMode="decimal" placeholder="e.g. 90000" className={field} />
          </div>
        )}
      </div>

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
