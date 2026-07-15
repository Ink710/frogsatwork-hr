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
import { useT } from "./LocaleProvider";

const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const label = "block text-sm font-medium";

export function CreateEmployeeForm({ departments, managerOptions, canEditComp }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(createEmployee, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="firstName">{t("field.firstName")}</label>
          <input id="firstName" name="firstName" required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="lastName">{t("field.lastName")}</label>
          <input id="lastName" name="lastName" required className={field} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="email">{t("field.email")}</label>
        <input id="email" name="email" type="email" required className={field} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="hireDate">{t("field.hireDate")}</label>
          <input id="hireDate" name="hireDate" type="date" defaultValue={today} required className={field} />
        </div>
        <div>
          <label className={label} htmlFor="employmentType">{t("field.employmentType")}</label>
          <select id="employmentType" name="employmentType" defaultValue="FULL_TIME" className={field}>
            {EMPLOYMENT_TYPE_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.employmentType.${v}`)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="jobTitle">{t("field.jobTitle")}</label>
        <input id="jobTitle" name="jobTitle" required className={field} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="departmentId">{t("field.department")}</label>
          <select id="departmentId" name="departmentId" required className={field}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="managerId">{t("field.manager")}</label>
          <select id="managerId" name="managerId" defaultValue="" className={field}>
            <option value="">{t("common.none")}</option>
            {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="flsaClassification">{t("field.flsa")}</label>
          <select id="flsaClassification" name="flsaClassification" defaultValue="EXEMPT" className={field}>
            {FLSA_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.flsa.${v}`)}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="payFrequency">{t("field.payFrequency")}</label>
          <select id="payFrequency" name="payFrequency" defaultValue="SEMI_MONTHLY" className={field}>
            {PAY_FREQUENCY_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payFrequency.${v}`)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="role">{t("field.role")}</label>
          <select id="role" name="role" defaultValue="EMPLOYEE" className={field}>
            {ROLE_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.role.${v}`)}</option>)}
          </select>
        </div>
        {canEditComp && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="salary">{t("field.salary")}</label>
              <input id="salary" name="salary" inputMode="decimal" placeholder="e.g. 90000" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="payBasis">{t("field.payBasis")}</label>
              <select id="payBasis" name="payBasis" defaultValue="PER_YEAR" className={field}>
                {PAY_BASIS_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payBasis.${v}`)}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <fieldset className="rounded-md border border-border p-4 ">
        <legend className="px-1 text-sm font-medium">{t("create.contactSchedule")}</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="phone">{t("field.phone")}</label>
            <input id="phone" name="phone" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="location">{t("field.location")}</label>
            <input id="location" name="location" placeholder="e.g. Austin, TX" className={field} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="workSchedule">{t("field.workSchedule")}</label>
            <input id="workSchedule" name="workSchedule" placeholder="e.g. Mon–Fri, 09:00–18:00" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="timeZone">{t("field.timeZone")}</label>
            <input id="timeZone" name="timeZone" placeholder="e.g. America/Chicago" className={field} />
          </div>
        </div>
      </fieldset>

      {canEditComp && (
        <fieldset className="rounded-md border border-border p-4 ">
          <legend className="px-1 text-sm font-medium">{t("create.compDetails")}</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="lastReviewDate">{t("field.lastReview")}</label>
              <input id="lastReviewDate" name="lastReviewDate" type="date" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nextReviewDate">{t("field.nextReview")}</label>
              <input id="nextReviewDate" name="nextReviewDate" type="date" className={field} />
            </div>
          </div>
          <div className="mt-4">
            <label className={label} htmlFor="equityNote">{t("field.equity")}</label>
            <input id="equityNote" name="equityNote" placeholder="e.g. 4-yr cliff · yr 1" className={field} />
          </div>
        </fieldset>
      )}

      <fieldset className="rounded-md border border-border p-4 ">
        <legend className="px-1 text-sm font-medium">{t("create.emergencyContact")}</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="emergencyContactName">{t("field.name")}</label>
            <input id="emergencyContactName" name="emergencyContactName" required className={field} />
          </div>
          <div>
            <label className={label} htmlFor="emergencyContactRelationship">{t("field.relationship")}</label>
            <input id="emergencyContactRelationship" name="emergencyContactRelationship" required className={field} />
          </div>
        </div>
        <div className="mt-4">
          <label className={label} htmlFor="emergencyContactPhone">{t("field.phone")}</label>
          <input id="emergencyContactPhone" name="emergencyContactPhone" required className={field} />
        </div>
      </fieldset>

      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? t("create.creating") : t("create.submit")}
      </button>
    </form>
  );
}
