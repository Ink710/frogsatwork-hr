"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { requestErasure } from "@/app/careers/actions";

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// Deliberately the smallest form in the app: an address and an optional sentence. Asking a data
// subject to prove who they are before we'll accept their request would be its own dark pattern —
// verification is HR's job, on the other side, where they can check against a record we already hold.
export function ErasureRequestForm() {
  const t = useT();
  const [state, action, pending] = useActionState(requestErasure, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Same honeypot as the apply form: off-screen, unfocusable, never announced. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="email">
          {t("erasure.email")}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={INPUT} />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="reason">
          {t("erasure.reason")}
        </label>
        <textarea id="reason" name="reason" rows={3} className={INPUT} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? t("erasure.submitting") : t("erasure.submit")}
        </button>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}
