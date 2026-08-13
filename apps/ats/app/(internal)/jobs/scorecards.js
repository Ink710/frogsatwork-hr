"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { scorecardDraftSchema, isScorecardComplete } from "@hris/recruiting";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

// Pull the ratings out of the form. The client posts one field per competency
// (`rating:<competencyId>` / `comment:<competencyId>`), which keeps the form flat and lets the
// action stay agnostic about how many competencies a job defines.
function parseRatings(formData) {
  const ratings = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("rating:")) continue;
    const competencyId = key.slice("rating:".length);
    const raw = String(value).trim();
    if (raw === "") continue; // unrated — legal in a draft
    ratings.push({
      competencyId,
      rating: Number(raw),
      comment: String(formData.get(`comment:${competencyId}`) ?? "").trim() || undefined,
    });
  }
  return ratings;
}

// Load the application (RLS-scoped) + the job's competencies + the viewer's own scorecard.
// Everything here is scoped by RLS, so a viewer off the hiring team simply finds nothing.
async function loadContext(tx, viewer, applicationId, t) {
  const application = await tx.application.findFirst({
    where: { id: applicationId },
    select: { id: true, jobId: true, currentRoundId: true },
  });
  if (!application) throw new Error(t("err.applicationNotFound"));

  const competencies = await tx.jobCompetency.findMany({
    where: { jobId: application.jobId },
    orderBy: { position: "asc" },
    select: { id: true, name: true },
  });
  const existing = await tx.scorecard.findFirst({
    where: { applicationId, authorEmployeeId: viewer.employeeId },
    select: { id: true, status: true },
  });
  return { application, competencies, existing };
}

/**
 * Refuse to OPEN new feedback outside the interview stage (M15).
 *
 * Only ever consulted when there is no existing scorecard — an interviewer holding a draft may
 * always finish it, because the draft could only have been created while the candidate was at
 * INTERVIEW in the first place.
 *
 * The `scorecard_insert` RLS policy is the actual enforcement; this check exists so the person gets
 * a sentence explaining the rule instead of a generic "couldn't save". It calls the SAME database
 * function the policy does, so the two cannot disagree about when the window is open.
 */
async function requireOpenFeedbackWindow(tx, applicationId, t) {
  const [row] = await tx.$queryRaw`SELECT app_can_start_feedback(${applicationId}) AS ok`;
  if (!row?.ok) throw new Error(t("err.feedbackClosed"));
}

// Write the viewer's ratings, replacing whatever was there. Delete-then-insert (rather than
// diffing) is safe because ratings only ever belong to one draft scorecard, and it keeps the
// competencyName SNAPSHOT fresh for the competencies that still exist.
async function writeRatings(tx, scorecardId, ratings, competencies) {
  const byId = new Map(competencies.map((c) => [c.id, c.name]));
  await tx.scorecardRating.deleteMany({ where: { scorecardId } });
  const valid = ratings.filter((r) => byId.has(r.competencyId));
  if (valid.length === 0) return;
  await tx.scorecardRating.createMany({
    data: valid.map((r) => ({
      scorecardId,
      competencyId: r.competencyId,
      competencyName: byId.get(r.competencyId), // snapshot — survives a later rename/removal
      rating: r.rating,
      comment: r.comment ?? null,
    })),
  });
}

// Save (or create) the viewer's DRAFT. Permissive by design: an interview is half-finished for most
// of its duration. The scorecard_insert policy guarantees the row can only ever be authored by the
// caller, and scorecard_update guarantees a submitted one can't be reopened.
export async function saveScorecardDraft(applicationId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: t("err.notAuthorized") };

  const parsed = scorecardDraftSchema.safeParse({
    recommendation: formData.get("recommendation") || undefined,
    notes: formData.get("notes") || undefined,
    ratings: parseRatings(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const { application, competencies, existing } = await loadContext(tx, viewer, applicationId, t);
      if (existing?.status === "SUBMITTED") throw new Error(t("err.scorecardLocked"));

      let scorecardId = existing?.id;
      if (!scorecardId) {
        await requireOpenFeedbackWindow(tx, applicationId, t);
        const created = await tx.scorecard.create({
          data: {
            applicationId,
            jobId: application.jobId,
            interviewRoundId: application.currentRoundId,
            authorEmployeeId: viewer.employeeId,
            status: "DRAFT",
            recommendation: parsed.data.recommendation ?? null,
            notes: parsed.data.notes ?? null,
          },
        });
        scorecardId = created.id;
      } else {
        await tx.scorecard.update({
          where: { id: scorecardId },
          data: { recommendation: parsed.data.recommendation ?? null, notes: parsed.data.notes ?? null },
        });
      }
      await writeRatings(tx, scorecardId, parsed.data.ratings, competencies);
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.scorecardFailed") };
  }

  revalidatePath(`/jobs/*/applications/${applicationId}`, "page");
  return { ok: true, saved: true };
}

// Submit — the one-way door. Completeness is checked here (a pure rule from @hris/recruiting);
// immutability afterwards is enforced by the UPDATE policy, not by this code.
export async function submitScorecard(applicationId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer?.employeeId) return { error: t("err.notAuthorized") };

  const parsed = scorecardDraftSchema.safeParse({
    recommendation: formData.get("recommendation") || undefined,
    notes: formData.get("notes") || undefined,
    ratings: parseRatings(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      const { application, competencies, existing } = await loadContext(tx, viewer, applicationId, t);
      if (existing?.status === "SUBMITTED") throw new Error(t("err.scorecardLocked"));

      const complete = isScorecardComplete(competencies, parsed.data.ratings, parsed.data.recommendation);
      if (!complete.ok) {
        throw new Error(
          complete.reason === "MISSING_RECOMMENDATION"
            ? t("err.needRecommendation")
            : t("err.needRatings", { missing: complete.missing.join(", ") }),
        );
      }

      let scorecardId = existing?.id;
      if (!scorecardId) {
        await requireOpenFeedbackWindow(tx, applicationId, t);
        const created = await tx.scorecard.create({
          data: {
            applicationId,
            jobId: application.jobId,
            interviewRoundId: application.currentRoundId,
            authorEmployeeId: viewer.employeeId,
            status: "DRAFT",
          },
        });
        scorecardId = created.id;
      }
      // Ratings first: once status flips to SUBMITTED the row (and its children) are frozen by RLS.
      await writeRatings(tx, scorecardId, parsed.data.ratings, competencies);
      await tx.scorecard.update({
        where: { id: scorecardId },
        data: {
          recommendation: parsed.data.recommendation,
          notes: parsed.data.notes ?? null,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.scorecardFailed") };
  }

  revalidatePath(`/jobs/*/applications/${applicationId}`, "page");
  return { ok: true, submitted: true };
}
