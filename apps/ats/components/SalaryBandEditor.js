"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { PAY_BASES } from "@hris/recruiting";
import { setSalaryBand } from "@/app/(internal)/jobs/offers";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// The approved pay range for a requisition. This whole card only ever renders on the manage screen,
// which 404s for anyone who can't manage the req — and the DB refuses them the row regardless, so
// there is no gating logic to get wrong here.
export function SalaryBandEditor({ jobId, band }) {
  const t = useT();
  const [state, action, pending] = useActionState(setSalaryBand.bind(null, jobId), undefined);

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("band.hint")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="salaryMin" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("band.min")}
          </label>
          <input
            id="salaryMin"
            name="salaryMin"
            type="number"
            min="1"
            step="1"
            required
            defaultValue={band?.salaryMin ?? ""}
            className={`${INPUT} w-full font-mono`}
          />
        </div>
        <div>
          <label htmlFor="salaryMax" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("band.max")}
          </label>
          <input
            id="salaryMax"
            name="salaryMax"
            type="number"
            min="1"
            step="1"
            required
            defaultValue={band?.salaryMax ?? ""}
            className={`${INPUT} w-full font-mono`}
          />
        </div>
        <div>
          <label htmlFor="currency" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("band.currency")}
          </label>
          <input
            id="currency"
            name="currency"
            maxLength={3}
            required
            defaultValue={band?.currency ?? "USD"}
            className={`${INPUT} w-full uppercase`}
          />
        </div>
        <div>
          <label htmlFor="payBasis" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("band.payBasis")}
          </label>
          <select
            id="payBasis"
            name="payBasis"
            defaultValue={band?.payBasis ?? "PER_YEAR"}
            className={`${INPUT} w-full`}
          >
            {PAY_BASES.map((b) => (
              <option key={b} value={b}>
                {t(`enum.payBasis.${b}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pay transparency. Off unless asked for: several jurisdictions require the range on the ad
          and several employers treat it as confidential, so the app must not decide for the operator. */}
      <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
        <input
          type="checkbox"
          name="postPublicly"
          defaultChecked={band?.postPublicly ?? false}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">{t("band.postPublicly")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("band.postPubliclyHint")}</span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {band ? t("band.update") : t("band.set")}
        </button>
        {state?.ok && <span className="text-xs text-success">{t("common.saved")}</span>}
        {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
