"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@hris/database";
import { getApplicant } from "@/lib/auth";
import { getT } from "@/lib/i18n.server";
import { allowScheduleAttempt } from "@/lib/rate-limit";

/**
 * Book an interview time (M11).
 *
 * ⚠️ THE ACTION TAKES A SLOT ID AND NOTHING ELSE. It never accepts an application id — the doorway
 * DERIVES that from the session's account, which is what stops an applicant naming somebody else's
 * application. The M9 staff doorway does trust a supplied application id, and is safe only because
 * app_can_manage_job stands in front of it; this path has no such gate, so it uses the wrapper.
 *
 * ⚠️ LOSING THE RACE IS A NORMAL OUTCOME. The pool is shared, so another candidate may take the slot
 * between this page rendering and the click. `UNAVAILABLE` becomes "that time was just taken" and the
 * list re-renders without it — there is nothing to retry and nothing has gone wrong.
 */
export async function claimSlot(_prevState, formData) {
  const t = await getT();
  const applicant = await getApplicant();
  if (!applicant) return { error: t("schedule.signedOut") };

  if (!(await allowScheduleAttempt(applicant.accountId))) return { error: t("schedule.rateLimited") };

  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return { error: t("schedule.invalid") };

  let result;
  try {
    const rows = await prisma.$queryRaw`
      SELECT app_applicant_claim_slot(${applicant.accountId}, ${slotId}) AS result`;
    result = rows[0]?.result;
  } catch (e) {
    console.error("[schedule] claim failed", { slotId, error: e });
    return { error: t("schedule.failed") };
  }

  // Every code gets a sentence. A booking that quietly does nothing is indistinguishable, to the
  // person who tried, from one that worked.
  if (result === "UNAVAILABLE") return { error: t("schedule.taken") };
  if (result === "ALREADY_BOOKED") return { error: t("schedule.alreadyBooked") };
  if (result === "NOT_ELIGIBLE") return { error: t("schedule.notEligible") };
  if (result !== "OK") return { error: t("schedule.failed") };

  revalidatePath("/portal");
  return { ok: true };
}
