"use client";

import { useActionState, useState } from "react";
import { useT, useLocale } from "@hris/ui/client";
import { formatMoney, formatDate, INTL_LOCALE } from "@hris/ui";
import { PAY_BASES, classifyOffer, requiresOutOfBandReason } from "@hris/recruiting";
import {
  saveOfferDraft,
  extendOffer,
  recordOfferOutcome,
  reviseOffer,
} from "@/app/(internal)/jobs/offers";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

const STATUS_STYLES = {
  DRAFT: "bg-muted text-muted-foreground",
  EXTENDED: "bg-info/10 text-info",
  ACCEPTED: "bg-success/10 text-success",
  DECLINED: "bg-destructive/10 text-destructive",
  SUPERSEDED: "bg-muted text-muted-foreground",
};

const POSITION_STYLES = {
  IN_BAND: "bg-success/10 text-success",
  ABOVE: "bg-warning/10 text-warning",
  BELOW: "bg-warning/10 text-warning",
  NO_BAND: "bg-muted text-muted-foreground",
};

function Pill({ className, children }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
  );
}

// The band + compa-ratio read-out. Shown for a saved offer and, live, while one is being typed —
// from the SAME pure function the server validates with, so the two can never disagree about
// whether a justification is owed.
function BandReadout({ classification, t }) {
  const { position, compaRatio } = classification;
  return (
    <span className="flex items-center gap-2">
      <Pill className={POSITION_STYLES[position]}>{t(`enum.bandPosition.${position}`)}</Pill>
      {compaRatio !== null && (
        <span className="font-mono text-xs text-muted-foreground">
          {t("offer.compaRatio", { n: compaRatio.toFixed(2) })}
        </span>
      )}
    </span>
  );
}

function money(value, currency, locale) {
  return formatMoney(value, currency ?? "USD", locale) ?? "—";
}

// The editable form. Only ever rendered for a DRAFT while the application sits at OFFER.
function OfferForm({ jobId, appId, band, offer, t, locale }) {
  const [state, action, pending] = useActionState(saveOfferDraft.bind(null, jobId, appId), undefined);
  // Live classification as the recruiter types, so the justification field appears exactly when the
  // rule will demand it rather than after a failed submit.
  const [salary, setSalary] = useState(offer?.salary ?? "");
  const classification = classifyOffer(band, salary === "" ? null : Number(salary));
  const needsReason = requiresOutOfBandReason(classification.position);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="salary" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("offer.salary")}
          </label>
          <input
            id="salary"
            name="salary"
            type="number"
            min="1"
            step="1"
            required
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            className={`${INPUT} w-full font-mono`}
          />
        </div>
        <div>
          <label htmlFor="offerPayBasis" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("offer.payBasis")}
          </label>
          <select
            id="offerPayBasis"
            name="payBasis"
            defaultValue={offer?.payBasis ?? band?.payBasis ?? "PER_YEAR"}
            className={`${INPUT} w-full`}
          >
            {PAY_BASES.map((b) => (
              <option key={b} value={b}>
                {t(`enum.payBasis.${b}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="offerCurrency" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("offer.currency")}
          </label>
          <input
            id="offerCurrency"
            name="currency"
            maxLength={3}
            required
            defaultValue={offer?.currency ?? band?.currency ?? "USD"}
            className={`${INPUT} w-full uppercase`}
          />
        </div>
        <div>
          <label htmlFor="startDate" className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("offer.startDate")}
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={offer?.startDate ? String(offer.startDate).slice(0, 10) : ""}
            className={`${INPUT} w-full`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {band ? (
          <>
            <span className="text-muted-foreground">
              {t("offer.bandIs", {
                min: money(band.salaryMin, band.currency, locale),
                max: money(band.salaryMax, band.currency, locale),
              })}
            </span>
            <BandReadout classification={classification} t={t} />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{t("offer.noBand")}</span>
        )}
      </div>

      {needsReason && (
        <div>
          <label htmlFor="outOfBandReason" className="mb-1 block text-xs font-medium text-warning">
            {t("offer.outOfBandReason")}
          </label>
          <textarea
            id="outOfBandReason"
            name="outOfBandReason"
            rows={2}
            required
            defaultValue={offer?.outOfBandReason ?? ""}
            className={`${INPUT} w-full`}
          />
        </div>
      )}

      <div>
        <label htmlFor="offerNotes" className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("offer.notes")}
        </label>
        <textarea
          id="offerNotes"
          name="notes"
          rows={2}
          defaultValue={offer?.notes ?? ""}
          className={`${INPUT} w-full`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {t("offer.saveDraft")}
        </button>
        {state?.saved && <span className="text-xs text-success">{t("offer.saved")}</span>}
        {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}

// The buttons that move an offer through its lifecycle. Extending is the one-way door, so it asks
// first; accept/decline and revise do not, because they record something that already happened.
function OfferActions({ jobId, appId, offer, t }) {
  const [confirming, setConfirming] = useState(false);
  const [extendState, extendAction, extending] = useActionState(
    extendOffer.bind(null, jobId, appId, offer.id),
    undefined,
  );
  const [outcomeState, outcomeAction, recording] = useActionState(
    recordOfferOutcome.bind(null, jobId, appId, offer.id),
    undefined,
  );
  const [reviseState, reviseAction, revising] = useActionState(
    reviseOffer.bind(null, jobId, appId, offer.id),
    undefined,
  );
  const error = extendState?.error || outcomeState?.error || reviseState?.error;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {offer.status === "DRAFT" &&
          (confirming ? (
            <form action={extendAction} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("offer.extendConfirm")}</span>
              <button
                type="submit"
                disabled={extending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {t("offer.extendConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t("offer.extend")}
            </button>
          ))}

        {offer.status === "EXTENDED" && (
          <>
            <form action={outcomeAction}>
              <input type="hidden" name="outcome" value="ACCEPTED" />
              <button
                type="submit"
                disabled={recording}
                className="rounded-md border border-success/40 px-3 py-1.5 text-sm font-medium text-success hover:bg-success/10 disabled:opacity-60"
              >
                {t("offer.markAccepted")}
              </button>
            </form>
            <form action={outcomeAction}>
              <input type="hidden" name="outcome" value="DECLINED" />
              <button
                type="submit"
                disabled={recording}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
              >
                {t("offer.markDeclined")}
              </button>
            </form>
          </>
        )}

        {(offer.status === "EXTENDED" || offer.status === "DECLINED") && (
          <form action={reviseAction}>
            <button
              type="submit"
              disabled={revising}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
            >
              {t("offer.revise")}
            </button>
          </form>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// One offer version, read-only.
function OfferSummary({ offer, t, locale }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg font-semibold">
          {money(offer.salary, offer.currency, locale)}
        </span>
        <span className="text-xs text-muted-foreground">{t(`enum.payBasis.${offer.payBasis}`)}</span>
        <Pill className={STATUS_STYLES[offer.status]}>{t(`enum.offerStatus.${offer.status}`)}</Pill>
        <BandReadout classification={offer.classification} t={t} />
      </div>
      {offer.startDate && (
        <p className="text-xs text-muted-foreground">
          {t("offer.startsOn", { date: formatDate(offer.startDate, locale) })}
        </p>
      )}
      {offer.outOfBandReason && (
        <p className="text-xs text-warning">
          {t("offer.outOfBandReason")}: {offer.outOfBandReason}
        </p>
      )}
      {offer.notes && <p className="text-xs text-muted-foreground">{offer.notes}</p>}
    </div>
  );
}

/**
 * The offer card.
 *
 * The parent renders this ONLY when getOfferPanel returned something — which it does only for a
 * viewer who may manage the req. There is deliberately no "hidden" state to render: an interviewer's
 * page contains no offer markup at all, not markup they can't see.
 */
export function OfferPanel({ jobId, appId, panel }) {
  const t = useT();
  const locale = INTL_LOCALE[useLocale()];
  const { band, offers, current, canWrite } = panel;
  const history = offers.filter((o) => o.id !== current?.id);

  return (
    <div className="flex flex-col gap-4">
      {!canWrite && (
        // Reading persists after OFFER on purpose — the agreed figures are what HR onboards from.
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("offer.readOnly")}
        </p>
      )}

      {current ? (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <OfferSummary offer={current} t={t} locale={locale} />
            <span className="font-mono text-xs text-muted-foreground">v{current.version}</span>
          </div>
          {canWrite && current.status === "DRAFT" && (
            <div className="mt-3 border-t border-border pt-3">
              <OfferForm jobId={jobId} appId={appId} band={band} offer={current} t={t} locale={locale} />
            </div>
          )}
          {canWrite && <OfferActions jobId={jobId} appId={appId} offer={current} t={t} />}
        </div>
      ) : canWrite ? (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">{t("offer.empty")}</p>
          <OfferForm jobId={jobId} appId={appId} band={band} offer={null} t={t} locale={locale} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("offer.none")}</p>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("offer.history")}
          </h3>
          <ul className="flex flex-col gap-2">
            {history.map((o) => (
              <li key={o.id} className="rounded-lg border border-border/60 p-3 opacity-80">
                <div className="flex items-start justify-between gap-2">
                  <OfferSummary offer={o} t={t} locale={locale} />
                  <span className="font-mono text-xs text-muted-foreground">v{o.version}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
