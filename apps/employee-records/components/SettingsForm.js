"use client";

import { useActionState } from "react";
import { setStorageDir } from "@/app/settings/actions";
import { useT } from "@hris/ui/client";

// `driver` is the active STORAGE_DRIVER. The base-directory setting only means anything for the
// LOCAL driver — under object storage there is no filesystem path to configure, and presenting an
// editable one would be inviting someone to change a value that does nothing.
export function SettingsForm({ storageDir, driver = "local" }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(setStorageDir, {});
  const current = state?.value ?? storageDir;

  if (driver !== "local") {
    return (
      <div className="mt-6 max-w-xl rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        {t("settings.cloudDriver", { driver })}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 max-w-xl space-y-3">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success  ">{t("settings.saved")}</p>
      )}
      <div>
        <label className="block text-sm font-medium" htmlFor="storageDir">{t("settings.storageDir")}</label>
        <input
          id="storageDir"
          name="storageDir"
          defaultValue={current}
          placeholder="/Users/<Your filetree goes here>"
          required
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.storageHint")}</p>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? t("settings.saving") : t("settings.save")}
      </button>
    </form>
  );
}
