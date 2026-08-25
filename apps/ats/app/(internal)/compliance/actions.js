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
 *   1. app_erase_candidate commits. It returns EVERY résumé key it just detached (M7 — the CV on the
 *      profile plus any an earlier application still pinned).
 *   2. Only then do we delete the files.
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
  let resumeKeys;
  try {
    [{ result, resume_keys: resumeKeys }] = await withViewer(
      viewer,
      (tx) =>
        tx.$queryRaw`SELECT result, resume_keys FROM app_erase_candidate(
          ${candidateId}, ${parsed.data.note ?? null})`,
    );
  } catch {
    return { error: t("err.erasureFailed") };
  }

  if (result !== "OK") return { error: t(ERROR_KEYS[result] ?? "err.erasureFailed") };

  // ⚠️ M7: A SET OF KEYS, NOT ONE. With the résumé pinned per application, a person can hold several
  // files — the CV on their profile plus whichever ones earlier applications still reference — and
  // erasure is the only thing that will ever delete any of them. Returning just the current key
  // would have left every superseded CV of an erased person sitting in the store.
  //
  // Every delete is attempted even if one fails: stopping at the first would leave later files
  // behind with nothing recording that they exist. The message is the same either way — one
  // unremoved résumé is already a privacy failure, and a count would not tell HR anything they can
  // act on that the logs do not.
  let anyLeft = false;
  for (const key of resumeKeys ?? []) {
    try {
      await storage.remove(key);
    } catch (e) {
      console.error("[erasure] résumé left in storage", { candidateId, key, error: e });
      anyLeft = true;
    }
  }

  if (anyLeft) {
    revalidatePath("/compliance");
    revalidatePath(`/candidates/${candidateId}`);
    return { error: t("err.erasureFileLeft") };
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
