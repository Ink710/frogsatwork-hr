"use client";

import { useActionState } from "react";
import { setStorageDir } from "@/app/settings/actions";

export function SettingsForm({ storageDir }) {
  const [state, formAction, pending] = useActionState(setStorageDir, {});
  const current = state?.value ?? storageDir;

  return (
    <form action={formAction} className="mt-6 max-w-xl space-y-3">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">Saved.</p>
      )}
      <div>
        <label className="block text-sm font-medium" htmlFor="storageDir">Document storage folder</label>
        <input
          id="storageDir"
          name="storageDir"
          defaultValue={current}
          required
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-400">Absolute path where uploaded files are stored. New uploads land here.</p>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
