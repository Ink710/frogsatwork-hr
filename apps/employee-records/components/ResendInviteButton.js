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
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50  "
      >
        {pending ? t("invite.sending") : (label ?? t("profile.resendInvite"))}
      </button>
      {state?.ok && <span className="text-xs text-success ">{t("invite.sent")}</span>}
      {state?.error && <span className="text-xs text-destructive ">{state.error}</span>}
    </form>
  );
}
