"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { submitApplication } from "@/app/careers/actions";

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// The public apply form. encType is multipart so the résumé file reaches the server action.
export function ApplyForm({ jobId }) {
  const t = useT();
  const [state, action, pending] = useActionState(submitApplication.bind(null, jobId), undefined);

  return (
    <form action={action} encType="multipart/form-data" className="flex flex-col gap-4">
      {/* Honeypot: visually hidden, not display:none (some bots skip hidden inputs), never focusable
          or announced. A human never fills this; a bot fills every field it finds. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="firstName">
            {t("apply.firstName")}
          </label>
          <input id="firstName" name="firstName" required autoComplete="given-name" className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="lastName">
            {t("apply.lastName")}
          </label>
          <input id="lastName" name="lastName" required autoComplete="family-name" className={INPUT} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="email">
            {t("apply.email")}
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="phone">
            {t("apply.phone")}
          </label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={INPUT} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="resume">
          {t("apply.resume")}
        </label>
        <input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx" className={`${INPUT} file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm`} />
        <p className="mt-1 text-xs text-muted-foreground">{t("apply.resumeHint")}</p>
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="note">
          {t("apply.note")}
        </label>
        <textarea id="note" name="note" rows={4} className={INPUT} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? t("apply.submitting") : t("apply.submit")}
        </button>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}
