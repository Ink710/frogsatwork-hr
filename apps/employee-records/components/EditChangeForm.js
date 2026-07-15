"use client";

import { useActionState } from "react";
import { recordChange } from "@/app/employees/[id]/actions";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  FLSA_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  PAY_BASIS_OPTIONS,
} from "@/lib/enums";
import { useT } from "./LocaleProvider";

const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const label = "block text-sm font-medium";

export function EditChangeForm({ employeeId, employee, current, departments, managerOptions, canEditComp }) {
  const t = useT();
  const action = recordChange.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">
          {state.error}
        </p>
      )}

      <div>
        <label className={label} htmlFor="jobTitle">{t("field.jobTitle")}</label>
        <input id="jobTitle" name="jobTitle" defaultValue={current?.jobTitle ?? ""} required className={field} />
      </div>

      <div>
        <label className={label} htmlFor="employmentType">{t("field.employmentType")}</label>
        <select id="employmentType" name="employmentType" defaultValue={current?.employmentType ?? "FULL_TIME"} className={field}>
          {EMPLOYMENT_TYPE_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.employmentType.${v}`)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="flsaClassification">{t("field.flsa")}</label>
          <select id="flsaClassification" name="flsaClassification" defaultValue={current?.flsaClassification ?? "EXEMPT"} className={field}>
            {FLSA_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.flsa.${v}`)}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="payFrequency">{t("field.payFrequency")}</label>
          <select id="payFrequency" name="payFrequency" defaultValue={current?.payFrequency ?? "SEMI_MONTHLY"} className={field}>
            {PAY_FREQUENCY_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payFrequency.${v}`)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="departmentId">{t("field.department")}</label>
        <select id="departmentId" name="departmentId" defaultValue={employee.departmentId} className={field}>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="managerId">{t("field.manager")}</label>
        <select id="managerId" name="managerId" defaultValue={employee.managerId ?? ""} className={field}>
          <option value="">{t("common.none")}</option>
          {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {canEditComp && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="salary">{t("field.salary")}</label>
            <input id="salary" name="salary" defaultValue={current?.salary ?? ""} inputMode="decimal" placeholder="e.g. 120000" className={field} />
            <input type="hidden" name="currency" value={current?.currency ?? "USD"} />
          </div>
          <div>
            <label className={label} htmlFor="payBasis">{t("field.payBasis")}</label>
            <select id="payBasis" name="payBasis" defaultValue={current?.payBasis ?? "PER_YEAR"} className={field}>
              {PAY_BASIS_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payBasis.${v}`)}</option>)}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor="effectiveFrom">{t("field.effectiveDate")}</label>
        <input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} min={today} required className={field} />
        <p className="mt-1 text-xs text-muted-foreground">{t("edit.noBackdate")}</p>
      </div>

      <div>
        <label className={label} htmlFor="changeReason">{t("field.reasonOptional")}</label>
        <input id="changeReason" name="changeReason" placeholder={t("edit.reasonPlaceholder")} className={field} />
      </div>

      <button type="submit" disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? t("edit.recording") : t("edit.submit")}
      </button>
    </form>
  );
}
