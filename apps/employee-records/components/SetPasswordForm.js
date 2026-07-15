"use client";

import { useActionState } from "react";
import { setPassword } from "@/app/set-password/actions";
import { useT } from "./LocaleProvider";

export function SetPasswordForm({ token }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(setPassword, {});

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {/* The raw invite token travels back to the action here; it's never stored server-side. */}
      <input type="hidden" name="token" value={token} />
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">
          {state.error}
        </p>
      )}
      <div>
        <label className="block text-sm font-medium" htmlFor="password">{t("setpw.newPassword")}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="confirm">{t("setpw.confirm")}</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t("setpw.setting") : t("setpw.submit")}
      </button>
    </form>
  );
}
