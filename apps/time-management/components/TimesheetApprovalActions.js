"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { decideTimesheet } from "@/app/timesheets/actions";

// Approve / reject a submitted timesheet — one form, two buttons routed through decideTimesheet via
// useActionState so an error (e.g. it stopped being submitted) surfaces inline.
export function TimesheetApprovalActions({ timesheetId }) {
  const t = useT();
  const [state, action, pending] = useActionState(decideTimesheet.bind(null, timesheetId), undefined);

  return (
    <form action={action} className="flex flex-col items-stretch gap-2 sm:w-72">
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      <input
        name="decisionNote"
        placeholder={t("approvals.notePlaceholder")}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
      <div className="flex gap-2">
        <button type="submit" name="intent" value="approve" disabled={pending} className="flex-1 rounded-md bg-success px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {t("approvals.approve")}
        </button>
        <button type="submit" name="intent" value="reject" disabled={pending} className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {t("approvals.reject")}
        </button>
      </div>
    </form>
  );
}
