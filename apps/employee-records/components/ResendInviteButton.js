"use client";

import { useActionState } from "react";
import { resendInvite } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

// Small HR-only control on an unactivated employee's profile. Binds the userId and reports
// success/failure inline. `label` (already translated by the caller) says "Send invite" vs "Resend".
export function ResendInviteButton({ userId, label }) {
  const t = useT();
  const action = resendInvite.bind(null, userId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? t("invite.sending") : (label ?? t("profile.resendInvite"))}
      </button>
      {state?.ok && <span className="text-xs text-green-600 dark:text-green-400">{t("invite.sent")}</span>}
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
