"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { createStorage } from "@hris/storage";
import { erasureDecisionSchema } from "@hris/recruiting";
import { getT } from "@/lib/i18n.server";

const storage = createStorage();

// Maps the doorway's return codes onto messages. Every code gets one: an erasure that quietly does
// nothing is indistinguishable, to the person who asked for it, from one that worked.
const ERROR_KEYS = {
  FORBIDDEN: "err.erasureForbidden",
  NOT_FOUND: "err.erasureNotFound",
  HIRED: "err.erasureHired",
  ALREADY_ERASED: "err.erasureAlready",
};

/**
 * Erase a candidate's personal data.
 *
 * The work is split across two systems that cannot share a transaction — Postgres holds the record,
 * the storage driver holds the résumé file — so the order is chosen deliberately:
 *
 *   1. app_erase_candidate commits. It returns the résumé key it just detached.
 *   2. Only then do we delete the file.
 *
 * Doing it the other way round would mean a failed transaction leaves a live candidate with a
 * missing résumé — data loss for someone who never asked for it. This way the worst case is an
 * orphaned file, which is recoverable. But an orphaned RÉSUMÉ after a promised erasure is still a
 * privacy failure, not a cosmetic one, so a failed delete is SURFACED rather than swallowed: the DB
 * work stands (it can't be rolled back anyway), and the message tells HR exactly what is left to do.
 * Same shape as M8's post-commit hire link, and the same rule — best effort, never silent.
 */
export async function eraseCandidate(candidateId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.erasureForbidden") };

  // A typed confirmation, because this is the only irreversible action in the app. The word is
  // translated nowhere — an English keyword in every locale is a deliberate speed bump.
  if (String(formData.get("confirm") ?? "").trim() !== "ERASE") {
    return { error: t("err.erasureConfirm") };
  }

  const parsed = erasureDecisionSchema.safeParse({ note: formData.get("note") || undefined });
  if (!parsed.success) return { error: t("err.invalidInput") };

  let result;
  let resumeKey;
  try {
    [{ result, resume_key: resumeKey }] = await withViewer(
      viewer,
      (tx) =>
        tx.$queryRaw`SELECT result, resume_key FROM app_erase_candidate(
          ${candidateId}, ${parsed.data.note ?? null})`,
    );
  } catch {
    return { error: t("err.erasureFailed") };
  }

  if (result !== "OK") return { error: t(ERROR_KEYS[result] ?? "err.erasureFailed") };

  if (resumeKey) {
    try {
      await storage.remove(resumeKey);
    } catch {
      revalidatePath("/compliance");
      revalidatePath(`/candidates/${candidateId}`);
      return { error: t("err.erasureFileLeft") };
    }
  }

  revalidatePath("/compliance");
  revalidatePath("/candidates");
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

/**
 * Refuse a request without erasing anything — e.g. the person turned out to be an employee, or we
 * hold nothing that matches.
 *
 * A plain UPDATE rather than a function, because unlike an erasure this needs no privilege the
 * caller doesn't already have: the ErasureRequest RLS policy is already HR_ADMIN-only, so the
 * database refuses this for anyone else without any help from here.
 *
 * The note is REQUIRED. A refused data-subject request with no recorded reason is precisely the hole
 * an auditor goes looking for.
 */
export async function refuseErasureRequest(requestId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.erasureForbidden") };

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: t("err.invalidInput") };

  try {
    const updated = await withViewer(viewer, (tx) =>
      tx.erasureRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: {
          status: "REFUSED",
          decisionNote: note.slice(0, 1000),
          resolvedAt: new Date(),
          resolvedById: viewer.employeeId ?? null,
        },
      }),
    );
    // updateMany, not update: RLS makes a forbidden row simply invisible, so the honest report is
    // "nothing matched", never a crash.
    if (updated.count === 0) return { error: t("err.erasureForbidden") };
  } catch {
    return { error: t("err.erasureFailed") };
  }

  revalidatePath("/compliance");
  return { ok: true };
}
