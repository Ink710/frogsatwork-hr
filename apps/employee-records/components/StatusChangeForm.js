"use client";

import { useActionState } from "react";
import { startStatusChange } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

const fieldCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const labelCls = "block text-sm font-medium";

export function StatusChangeForm({ employeeId, type }) {
  const t = useT();
  const action = startStatusChange.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});
  const today = new Date().toLocaleDateString("en-CA");
  const isSuspension = type === "SUSPENSION";

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}
      {/* Type is fixed by the entry point (the button that got you here). */}
      <input type="hidden" name="type" value={type} />
      <div>
        <label className={labelCls} htmlFor="startDate">{t("status.startDate")}</label>
        <input id="startDate" name="startDate" type="date" defaultValue={today} min={today} required className={fieldCls} />
      </div>
      <div>
        <label className={labelCls} htmlFor="expectedEnd">{t("status.expectedEnd")}</label>
        <input id="expectedEnd" name="expectedEnd" type="date" min={today} className={fieldCls} />
      </div>
      <div>
        <label className={labelCls} htmlFor="reason">
          {isSuspension ? t("status.reasonSuspension") : t("status.reasonLeave")}
        </label>
        <textarea id="reason" name="reason" required rows={3} className={fieldCls} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-warning px-4 py-2 text-sm font-medium text-white hover:bg-warning/90 disabled:opacity-50"
      >
        {pending ? t("status.submitting") : isSuspension ? t("status.submitSuspendBtn") : t("status.submitLeaveBtn")}
      </button>
    </form>
  );
}
