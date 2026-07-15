"use client";

import { useActionState } from "react";
import { terminateEmployee } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

const fieldCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const labelCls = "block text-sm font-medium";

export function TerminateForm({ employeeId }) {
  const t = useT();
  const action = terminateEmployee.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}
      <div>
        <label className={labelCls} htmlFor="terminationDate">{t("terminate.date")}</label>
        <input id="terminationDate" name="terminationDate" type="date" defaultValue={today} min={today} required className={fieldCls} />
      </div>
      <div>
        <label className={labelCls} htmlFor="terminationReason">{t("terminate.reasonLabel")}</label>
        <textarea id="terminationReason" name="terminationReason" required rows={3} className={fieldCls} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="eligibleForRehire" defaultChecked />
        {t("terminate.eligible")}
      </label>
      <button type="submit" disabled={pending}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50">
        {pending ? t("terminate.submitting") : t("terminate.submit")}
      </button>
    </form>
  );
}
