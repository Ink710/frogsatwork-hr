"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import {
  INPUT,
  LABEL,
  emptyJob,
  emptyStudy,
  useRows,
  EmploymentRows,
  EducationRows,
} from "@/components/HistoryRows";
import { saveProfile } from "@/app/portal/profile/actions";

/**
 * The profile an applicant maintains for themselves (M7).
 *
 * Same row editors as the apply form, which is the point of extracting them — but this is a
 * genuinely different form: no honeypot (there is a session), no consent (nothing is being submitted
 * to a req), no EEO (that is answered per application, not held on a person), no screening
 * questions.
 *
 * ⚠️ The CV is NOT part of this form. It is its own form on the page, because a file upload and a
 * text save have different failure modes and different costs — losing a page of typed history
 * because a 6 MB PDF was rejected would be a bad trade, and one submit button would guarantee it.
 */
export function ProfileForm({ profile }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveProfile, undefined);

  const jobs = useRows(profile?.employment ?? [], emptyJob);
  const studies = useRows(profile?.education ?? [], emptyStudy);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="employment" value={JSON.stringify(jobs.rows)} />
      <input type="hidden" name="education" value={JSON.stringify(studies.rows)} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.firstName")}</span>
          <input name="firstName" required autoComplete="given-name" defaultValue={profile?.firstName ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.lastName")}</span>
          <input name="lastName" required autoComplete="family-name" defaultValue={profile?.lastName ?? ""} className={INPUT} />
        </label>

        {/* ⚠️ READ-ONLY, and not merely disabled in the UI: `profilePersonSchema` has no email field
            and `app_applicant_save_profile` takes no email parameter, so there is nothing to post.
            It is the login identity and the per-org dedupe key — an unverified change would be an
            account-takeover surface. */}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>{t("apply.email")}</span>
          <input
            value={profile?.email ?? ""} readOnly disabled
            className={`${INPUT} cursor-not-allowed opacity-70`}
          />
          <span className="text-xs text-muted-foreground">{t("profile.emailFixed")}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.phone")}</span>
          <input name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone ?? ""} className={INPUT} />
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("apply.experience")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("apply.experienceHint")}</p>
        <EmploymentRows jobs={jobs} t={t} />
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("apply.education")}</h3>
        <EducationRows studies={studies} t={t} />
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? t("profile.saving") : t("profile.save")}
        </button>
        {state?.ok && <span className="text-sm text-primary">{t("profile.saved")}</span>}
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
