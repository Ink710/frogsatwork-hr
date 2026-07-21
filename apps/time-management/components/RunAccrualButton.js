"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { runAccrualNow } from "@/app/time-off/actions";

// HR-admin button that runs this month's accrual on demand (the dev stand-in for the Vercel Cron).
export function RunAccrualButton() {
  const t = useT();
  const [state, action, pending] = useActionState(runAccrualNow, undefined);

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {t("policies.runAccrual")}
      </button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state?.ok && (
        <p className="text-xs text-success">
          {t("policies.accrualDone", { period: state.period, created: String(state.created) })}
        </p>
      )}
    </form>
  );
}
