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
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
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
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t("setpw.setting") : t("setpw.submit")}
      </button>
    </form>
  );
}
