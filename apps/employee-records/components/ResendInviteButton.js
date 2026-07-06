"use client";

import { useActionState } from "react";
import { resendInvite } from "@/app/employees/[id]/actions";

// Small HR-only control on an unactivated employee's profile. Binds the userId and reports
// success/failure inline. `label` lets the profile say "Send invite" vs "Resend invite".
export function ResendInviteButton({ userId, label = "Resend invite" }) {
  const action = resendInvite.bind(null, userId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "Sending…" : label}
      </button>
      {state?.ok && <span className="text-xs text-green-600 dark:text-green-400">Invite sent.</span>}
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
