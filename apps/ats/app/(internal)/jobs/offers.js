"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import {
  salaryBandSchema,
  offerSchema,
  canTransitionOffer,
  canEditOffer,
  canReviseOffer,
} from "@hris/recruiting";
import { viewerCanManageJob } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

async function requireManageableJob(tx, jobId, t) {
  if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
}

// A "YYYY-MM-DD" calendar date → UTC midnight. The suite convention: a start date is a day, not an
// instant, and storing it at local midnight would render as the day before in a negative-offset TZ.
function utcMidnight(value) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

// ---------------------------------------------------------------------------
// The band on a requisition
// ---------------------------------------------------------------------------

// Set or update the approved range. An upsert, not a create-then-edit pair: a req has at most one
// band (@@unique on jobId), and "set the band" is one intention whether or not one existed before.
export async function setSalaryBand(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  const parsed = salaryBandSchema.safeParse({
    salaryMin: formData.get("salaryMin"),
    salaryMax: formData.get("salaryMax"),
    currency: formData.get("currency") || "USD",
    payBasis: formData.get("payBasis"),
    postPublicly: formData.get("postPublicly") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const d = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      await tx.salaryBand.upsert({
        where: { jobId },
        update: {
          salaryMin: d.salaryMin,
          salaryMax: d.salaryMax,
          currency: d.currency,
          payBasis: d.payBasis,
          postPublicly: d.postPublicly,
        },
        create: {
          jobId,
          salaryMin: d.salaryMin,
          salaryMax: d.salaryMax,
          currency: d.currency,
          payBasis: d.payBasis,
          postPublicly: d.postPublicly,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.bandFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  // The careers page reads the range through app_public_jobs(), so a change to postPublicly (or to
  // the figures themselves) changes what the public sees.
  revalidatePath("/careers");
  revalidatePath(`/careers/${jobId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/**
 * Load an application for an offer write, enforcing BOTH gates.
 *
 * `app_can_manage_job` is the access gate (and RLS backstops it — an interviewer's query finds no
 * offer rows at all). The OFFER-stage check is the separate WORKFLOW gate: writing an offer for
 * someone still at Screen would be recording a decision that hasn't been made.
 *
 * Reading is deliberately NOT gated on the stage. See getOfferPanel.
 */
async function requireOfferableApplication(tx, jobId, appId, t) {
  await requireManageableJob(tx, jobId, t);
  const app = await tx.application.findFirst({
    where: { id: appId, jobId },
    select: { id: true, stage: true },
  });
  if (!app) throw new Error(t("err.applicationNotFound"));
  if (app.stage !== "OFFER") throw new Error(t("err.notAtOffer"));
  return app;
}

/**
 * Parse the offer form against the band READ FROM THE DATABASE.
 *
 * ⚠️ The band is never taken from the submitted payload. offerSchema needs bandMin/bandMax to decide
 * whether a justification is required, and if those arrived from the form, anyone could post a band
 * wide enough to make their own offer "in band" and skip the control entirely. The client renders
 * the same rule from the same function for its live feedback; the server reads the real thing.
 */
async function parseOffer(tx, jobId, formData) {
  const band = await tx.salaryBand.findFirst({ where: { jobId } });
  const parsed = offerSchema.safeParse({
    salary: formData.get("salary"),
    currency: formData.get("currency") || band?.currency || "USD",
    payBasis: formData.get("payBasis") || band?.payBasis || "PER_YEAR",
    startDate: formData.get("startDate") || undefined,
    notes: formData.get("notes") || undefined,
    outOfBandReason: formData.get("outOfBandReason") || undefined,
    bandMin: band ? Number(band.salaryMin) : undefined,
    bandMax: band ? Number(band.salaryMax) : undefined,
  });
  return { parsed, band };
}

// Fields shared by a create and a draft edit, including the band SNAPSHOT.
function offerFields(d, band) {
  return {
    salary: d.salary,
    currency: d.currency,
    payBasis: d.payBasis,
    startDate: utcMidnight(d.startDate),
    notes: d.notes ?? null,
    // Cleared when the offer is back inside the band — a stale justification would explain a
    // departure that no longer exists.
    outOfBandReason: d.outOfBandReason ?? null,
    // The band as it stands right now. Recorded on every write of a DRAFT so the snapshot tracks the
    // figures being edited, and freezes the moment the offer is extended.
    bandMinSnapshot: band ? band.salaryMin : null,
    bandMaxSnapshot: band ? band.salaryMax : null,
  };
}

// Open the first offer for an application, or edit the current DRAFT. One action, because from the
// recruiter's side it is one act: "this is what we're offering."
export async function saveOfferDraft(jobId, appId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireOfferableApplication(tx, jobId, appId, t);
      const { parsed, band } = await parseOffer(tx, jobId, formData);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? t("err.invalidInput"));

      const existing = await tx.offer.findFirst({
        where: { applicationId: appId, status: { not: "SUPERSEDED" } },
        orderBy: { version: "desc" },
      });
      if (existing && !canEditOffer(existing.status)) throw new Error(t("err.offerLocked"));

      if (existing) {
        await tx.offer.update({ where: { id: existing.id }, data: offerFields(parsed.data, band) });
      } else {
        // No RETURNING trap here: offer_access judges the row by its jobId against the PARENT job,
        // which already exists, so the SELECT policy passes on the new row (unlike Job's own insert).
        await tx.offer.create({
          data: {
            applicationId: appId,
            jobId,
            createdById: viewer.userId,
            version: 1,
            status: "DRAFT",
            ...offerFields(parsed.data, band),
          },
        });
      }
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.offerFailed") };
  }

  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  return { ok: true, saved: true };
}

// Extend the draft — the one-way door. After this the figures are what the candidate was told, so
// they stop being editable and can only be superseded by a new version.
export async function extendOffer(jobId, appId, offerId, _prevState) {
  return transitionOffer(jobId, appId, offerId, "EXTENDED");
}

// Record what the candidate said. Both outcomes are terminal for this version.
export async function recordOfferOutcome(jobId, appId, offerId, _prevState, formData) {
  const outcome = formData.get("outcome");
  return transitionOffer(jobId, appId, offerId, outcome);
}

// The shared status move, validated by the pure rules so the action cannot invent a transition the
// lifecycle forbids (e.g. a DRAFT jumping straight to ACCEPTED).
async function transitionOffer(jobId, appId, offerId, toStatus) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireOfferableApplication(tx, jobId, appId, t);
      const offer = await tx.offer.findFirst({ where: { id: offerId, applicationId: appId } });
      if (!offer) throw new Error(t("err.offerNotFound"));
      if (!canTransitionOffer(offer.status, toStatus)) throw new Error(t("err.invalidOfferStatus"));
      await tx.offer.update({ where: { id: offerId }, data: { status: toStatus } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.offerFailed") };
  }

  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  return { ok: true };
}

/**
 * Revise — supersede the current offer with a new version at the next number.
 *
 * This is the reason the table is versioned. An in-place edit of an extended offer would destroy the
 * answer to "what did we first offer, and what did they sign?", which is precisely what a hiring
 * post-mortem or a pay-equity review asks. The old row keeps its own figures and its own band
 * snapshot; the new one starts as a DRAFT so the recruiter can work on it before it goes out.
 */
export async function reviseOffer(jobId, appId, offerId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireOfferableApplication(tx, jobId, appId, t);
      const offer = await tx.offer.findFirst({ where: { id: offerId, applicationId: appId } });
      if (!offer) throw new Error(t("err.offerNotFound"));
      if (!canReviseOffer(offer.status)) throw new Error(t("err.offerNotRevisable"));

      const band = await tx.salaryBand.findFirst({ where: { jobId } });
      const last = await tx.offer.findFirst({
        where: { applicationId: appId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      await tx.offer.update({ where: { id: offerId }, data: { status: "SUPERSEDED" } });
      // The new draft starts from the superseded figures — a revision is almost always a tweak, and
      // retyping the whole offer invites a transcription error in the one field nobody rechecks.
      await tx.offer.create({
        data: {
          applicationId: appId,
          jobId,
          createdById: viewer.userId,
          version: (last?.version ?? offer.version) + 1,
          status: "DRAFT",
          salary: offer.salary,
          currency: offer.currency,
          payBasis: offer.payBasis,
          startDate: offer.startDate,
          notes: offer.notes,
          outOfBandReason: offer.outOfBandReason,
          bandMinSnapshot: band ? band.salaryMin : null,
          bandMaxSnapshot: band ? band.salaryMax : null,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.offerFailed") };
  }

  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  return { ok: true };
}
