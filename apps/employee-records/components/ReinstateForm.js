"use client";

import { useActionState } from "react";
import { reinstateEmployee } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

const fieldCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const labelCls = "block text-sm font-medium";

export function ReinstateForm({ employeeId }) {
  const t = useT();
  const action = reinstateEmployee.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}
      <div>
        <label className={labelCls} htmlFor="returnDate">{t("reinstate.returnDate")}</label>
        <input id="returnDate" name="returnDate" type="date" defaultValue={today} min={today} required className={fieldCls} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? t("reinstate.submitting") : t("reinstate.submit")}
      </button>
    </form>
  );
}
