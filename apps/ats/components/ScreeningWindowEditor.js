"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { SCHEDULING_ZONES, hasScreeningWindow, formatCallWindow } from "@hris/recruiting";
import { saveScreeningWindow } from "@/app/(internal)/jobs/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const LABEL = "text-xs font-medium text-muted-foreground";

/**
 * The screening call window for a req (M13).
 *
 * Recruiters make screening calls themselves — nothing here is bookable. This sets the hours an
 * applicant sitting at SCREEN is told to be reachable, shown in the portal and sent in the SCREEN
 * email.
 *
 * ⚠️ THE PREVIEW IS THE POINT OF THE ZONE FIELD. A recruiter picking "09:00" is thinking in their
 * own head; the applicant may be in another country and reads the hours with the zone attached. So
 * the exact string the candidate will see is rendered back here, rather than left to be discovered
 * by whoever receives it.
 */
export function ScreeningWindowEditor({ jobId, window, defaultZone, locale }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveScreeningWindow.bind(null, jobId), null);

  const configured = hasScreeningWindow(window);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("screening.hint")}</p>

      {configured ? (
        <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          {t("screening.current", { window: formatCallWindow(window, locale) })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("screening.none")}</p>
      )}

      <form action={action} className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("screening.from")}</span>
          {/* type="time" produces exactly the zero-padded "HH:MM" the schema and the CHECK
              constraint require. An empty input submits "", which is how a window is CLEARED. */}
          <input
            name="screeningCallFrom"
            type="time"
            defaultValue={window?.from ?? ""}
            className={INPUT}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("screening.to")}</span>
          <input name="screeningCallTo" type="time" defaultValue={window?.to ?? ""} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("screening.timeZone")}</span>
          <select
            name="screeningCallTimeZone"
            defaultValue={window?.timeZone ?? defaultZone}
            className={INPUT}
          >
            {/* The empty option is not padding — it is the third field a recruiter must clear to
                remove the window, since the schema accepts all three empty and nothing in between. */}
            <option value="">{t("screening.noZone")}</option>
            {SCHEDULING_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? t("screening.saving") : t("screening.save")}
          </button>
          {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
        </div>
      </form>
    </div>
  );
}
