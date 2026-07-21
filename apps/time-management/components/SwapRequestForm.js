"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { requestSwap } from "@/app/schedule/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// Employee requests to drop (→ open) or swap one of their own shifts. The colleague list is the
// department roster; leaving it on "Drop" makes it a coverage-gap request.
export function SwapRequestForm({ shiftId, targets = [] }) {
  const t = useT();
  const [state, action, pending] = useActionState(requestSwap, undefined);

  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <input type="hidden" name="shiftId" value={shiftId} />

      <div>
        <label htmlFor="targetEmployeeId" className="block text-sm font-medium">{t("schedule.swap.target")}</label>
        <select id="targetEmployeeId" name="targetEmployeeId" defaultValue="" className={fieldCls}>
          <option value="">{t("schedule.swap.drop")}</option>
          {targets.map((tg) => (
            <option key={tg.id} value={tg.id}>{tg.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="reason" className="block text-sm font-medium">{t("schedule.swap.reason")}</label>
        <textarea id="reason" name="reason" rows={2} className={fieldCls} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {t("schedule.swap.submit")}
      </button>
    </form>
  );
}
