"use client";

import { useActionState } from "react";
import { rehireEmployee } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

const fieldCls = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelCls = "block text-sm font-medium";

export function RehireForm({ employeeId }) {
  const t = useT();
  const action = rehireEmployee.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">{state.error}</p>
      )}
      <div>
        <label className={labelCls} htmlFor="rehireDate">{t("rehire.date")}</label>
        <input id="rehireDate" name="rehireDate" type="date" defaultValue={today} min={today} required className={fieldCls} />
        <p className="mt-1 text-xs text-zinc-400">{t("rehire.hint")}</p>
      </div>
      <button type="submit" disabled={pending}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
        {pending ? t("rehire.submitting") : t("rehire.submit")}
      </button>
    </form>
  );
}
