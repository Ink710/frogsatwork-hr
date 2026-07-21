"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { cancelTimeOff } from "@/app/time-off/actions";

// Cancels one request (the subject's own, or a manager/HR acting for them). Bound to the request id;
// the server action re-checks authority + state. Shown only on PENDING/APPROVED requests.
export function CancelRequestButton({ requestId }) {
  const t = useT();
  const [state, action, pending] = useActionState(cancelTimeOff.bind(null, requestId), undefined);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {t("timeOff.cancel")}
      </button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
