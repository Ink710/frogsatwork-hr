"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { requestLoginLink } from "@/app/sign-in/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

export function SignInForm() {
  const t = useT();
  const [state, action, pending] = useActionState(requestLoginLink, undefined);

  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        {t("signin.email")}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        className={INPUT}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? t("signin.sending") : t("signin.submit")}
      </button>
      {/* The ONLY error this form can show is a malformed address. Every other outcome — including
          "we have never heard of you" — redirects to the same confirmation page. */}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
