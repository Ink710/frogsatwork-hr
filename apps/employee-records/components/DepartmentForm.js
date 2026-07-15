"use client";

import { useActionState } from "react";
import { createDepartment, updateDepartment } from "@/app/departments/actions";
import { useT } from "./LocaleProvider";

const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const label = "block text-sm font-medium";

// Shared by create and edit. `department` present → edit mode (binds updateDepartment); absent →
// create mode. `parentOptions` already excludes self + descendants in edit mode.
export function DepartmentForm({ department, parentOptions, headOptions }) {
  const t = useT();
  const action = department ? updateDepartment.bind(null, department.id) : createDepartment;
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-6 max-w-xl space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}

      <div>
        <label className={label} htmlFor="name">{t("dept.fieldName")}</label>
        <input id="name" name="name" defaultValue={department?.name ?? ""} required className={field} />
      </div>

      <div>
        <label className={label} htmlFor="parentDepartmentId">{t("dept.fieldParent")}</label>
        <select id="parentDepartmentId" name="parentDepartmentId" defaultValue={department?.parentDepartmentId ?? ""} className={field}>
          <option value="">{t("dept.parentNone")}</option>
          {parentOptions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="headUserId">{t("dept.fieldHead")}</label>
        <select id="headUserId" name="headUserId" defaultValue={department?.headUserId ?? ""} className={field}>
          <option value="">{t("common.none")}</option>
          {headOptions.map((h) => (
            <option key={h.userId} value={h.userId}>{h.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="budget">{t("dept.fieldBudget")} <span className="text-muted-foreground">({t("common.optional")})</span></label>
        <input id="budget" name="budget" inputMode="decimal" defaultValue={department?.budget ?? ""} placeholder="e.g. 500000" className={field} />
        <p className="mt-1 text-xs text-muted-foreground">{t("dept.budgetHint")}</p>
      </div>

      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? t("dept.saving") : department ? t("dept.saveChanges") : t("dept.createBtn")}
      </button>
    </form>
  );
}
