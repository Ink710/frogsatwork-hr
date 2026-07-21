"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/components/LocaleProvider";
import { deleteShift } from "@/app/schedule/actions";

export function DeleteShiftButton({ shiftId }) {
  const t = useT();
  const [state, action, pending] = useActionState(deleteShift.bind(null, shiftId), undefined);

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" /> {t("schedule.form.delete")}
      </button>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
