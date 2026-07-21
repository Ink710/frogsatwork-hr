"use client";

import { useActionState } from "react";
import { CheckCheck } from "lucide-react";
import { useT } from "@/components/LocaleProvider";
import { publishWeek } from "@/app/schedule/actions";

// Publishes this week's draft shifts → visible to the whole department. Managers/HR only.
export function PublishWeekButton({ weekStart }) {
  const t = useT();
  const [state, action, pending] = useActionState(publishWeek.bind(null, weekStart), undefined);

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        <CheckCheck className="h-4 w-4" aria-hidden="true" /> {t("schedule.publishWeek")}
      </button>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
