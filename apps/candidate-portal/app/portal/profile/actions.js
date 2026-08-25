"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@hris/database";
import { createStorage } from "@hris/storage";
import {
  profilePersonSchema,
  employmentListSchema,
  educationListSchema,
  resumeFileError,
  monthToDate,
} from "@hris/recruiting";
import { getApplicant } from "@/lib/auth";
import { getT } from "@/lib/i18n.server";
import { allowProfileWrite } from "@/lib/rate-limit";

const storage = createStorage();

// The applicant editing their OWN record (M7).
//
// ⚠️ THESE ARE THE FIRST WRITES IN THIS APP THAT TOUCH "Candidate", AND THEY GO THROUGH DOORWAYS FOR
// A REASON THAT IS EASY TO MISS. The RLS-join trap has a write form, and it is quieter than the read
// form: a bare `prisma.candidate.update()` here does not throw and does not warn — the table is
// governed by app_can_see_candidate ("are you STAFF who may see this person"), this connection
// carries no session variables, so the UPDATE matches zero rows and reports success. A read at least
// comes back visibly empty. Every statement below goes through a SECURITY DEFINER function scoped by
// account id, which also re-checks that the account is open and the candidate is not erased —
// sessions here are JWTs, so the data layer is the only place revocation can actually bite.

/** The signed-in applicant, or null. Every action starts here; nothing takes an id from the form. */
async function requireApplicant() {
  const applicant = await getApplicant();
  return applicant?.accountId ?? null;
}

/**
 * Save name, phone, work history and education.
 *
 * One doorway call, so a half-saved profile is not a state that exists. Deliberately does NOT touch
 * the application snapshots — that is M6's whole master-plus-snapshot split, and a test fails if it
 * ever starts to.
 */
export async function saveProfile(_prevState, formData) {
  const t = await getT();
  const accountId = await requireApplicant();
  if (!accountId) return { error: t("profile.signedOut") };

  if (!(await allowProfileWrite(accountId))) return { error: t("profile.rateLimited") };

  const parsed = profilePersonSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("profile.invalid") };

  // Same JSON round trip as the apply form — the shared row editor posts one field per history.
  let employment;
  let education;
  try {
    employment = employmentListSchema.parse(JSON.parse(formData.get("employment") || "[]"));
    education = educationListSchema.parse(JSON.parse(formData.get("education") || "[]"));
  } catch (e) {
    return { error: e?.issues?.[0]?.message ?? t("profile.invalid") };
  }

  const employmentRows = employment.map((e, i) => ({
    employer: e.employer,
    title: e.title,
    startDate: monthToDate(e.startDate),
    endDate: e.endDate ? monthToDate(e.endDate) : null,
    summary: e.summary ?? null,
    position: i,
  }));
  const educationRows = education.map((e, i) => ({
    institution: e.institution,
    qualification: e.qualification,
    startDate: e.startDate ? monthToDate(e.startDate) : null,
    endDate: e.endDate ? monthToDate(e.endDate) : null,
    position: i,
  }));

  let result;
  try {
    const rows = await prisma.$queryRaw`
      SELECT app_applicant_save_profile(
        ${accountId}, ${parsed.data.firstName}, ${parsed.data.lastName},
        ${parsed.data.phone ?? null},
        ${JSON.stringify(employmentRows)}::jsonb,
        ${JSON.stringify(educationRows)}::jsonb) AS result`;
    result = rows[0]?.result;
  } catch (e) {
    // Public surface, so the visitor gets a plain message — but the cause is always logged. Three
    // separate places in this suite once swallowed an error silently and left the platform logs
    // empty during a real outage.
    console.error("[profile] save failed", e);
    return { error: t("profile.failed") };
  }

  if (result !== "OK") return { error: t("profile.closed") };

  revalidatePath("/portal/profile");
  return { ok: true };
}

/**
 * Replace the CV on file.
 *
 * ⚠️ THE ORDER IS THE SAME ONE THE ERASURE ACTION USES, AND FOR THE SAME REASON. Postgres and the
 * storage driver cannot share a transaction, so:
 *
 *   1. put the new blob;
 *   2. call the doorway, which repoints the row and hands back the superseded key — but ONLY when no
 *      application still pins it (an application under review must keep the file it was submitted
 *      with);
 *   3. only then delete that superseded file.
 *
 * Doing it the other way round would leave a profile pointing at a file that no longer exists. This
 * way the worst case is a leftover blob, which is recoverable — and it is still SURFACED rather than
 * swallowed, because a résumé nobody can account for is a privacy problem, not an untidy one.
 */
export async function replaceResume(_prevState, formData) {
  const t = await getT();
  const accountId = await requireApplicant();
  if (!accountId) return { error: t("profile.signedOut") };

  if (!(await allowProfileWrite(accountId))) return { error: t("profile.rateLimited") };

  const file = formData.get("resume");
  if (!file || typeof file !== "object" || !file.size) return { error: t("profile.noFile") };

  const fileError = resumeFileError(file);
  if (fileError === "TOO_LARGE") return { error: t("apply.fileTooLarge") };
  if (fileError === "BAD_TYPE") return { error: t("apply.fileType") };

  // The key is generated server-side from a UUID, so a malicious filename can never influence the
  // storage path. The submitted name is kept for display only.
  const ext = file.name.split(".").pop().toLowerCase();
  const key = `resumes/${randomUUID()}.${ext}`;
  const fileName = file.name.slice(0, 200);

  try {
    await storage.put(key, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    console.error("[profile] resume upload failed", { key, error: e });
    return { error: t("profile.uploadFailed") };
  }

  return finishResumeSwap(accountId, key, fileName, t);
}

/**
 * Remove the CV from the profile without replacing it.
 *
 * The applicant's applications keep theirs — each pins the key it was submitted with, so taking the
 * CV off a profile is not a way to withdraw a document already under review. Erasure is the path for
 * that, and it is a different right with a different answer.
 */
export async function removeResume(_prevState) {
  const t = await getT();
  const accountId = await requireApplicant();
  if (!accountId) return { error: t("profile.signedOut") };

  if (!(await allowProfileWrite(accountId))) return { error: t("profile.rateLimited") };

  return finishResumeSwap(accountId, null, null, t);
}

// The half both paths share: repoint the row, then clean up whatever the doorway says is genuinely
// unreferenced. `newKey` null means "remove".
async function finishResumeSwap(accountId, newKey, fileName, t) {
  let result;
  let supersededKey;
  try {
    const rows = await prisma.$queryRaw`
      SELECT result, superseded_key FROM app_applicant_set_resume(
        ${accountId}, ${newKey}, ${fileName})`;
    result = rows[0]?.result;
    supersededKey = rows[0]?.superseded_key;
  } catch (e) {
    console.error("[profile] resume swap failed", e);
    // The blob is already stored and nothing references it, so take it back out rather than leave a
    // file erasure could never find.
    if (newKey) await storage.remove(newKey).catch(() => {});
    return { error: t("profile.failed") };
  }

  if (result !== "OK") {
    if (newKey) await storage.remove(newKey).catch(() => {});
    return { error: t("profile.closed") };
  }

  revalidatePath("/portal/profile");

  if (supersededKey) {
    try {
      await storage.remove(supersededKey);
    } catch (e) {
      console.error("[profile] superseded résumé left in storage", { key: supersededKey, error: e });
      // The database work stands and cannot be rolled back; say what is left over rather than
      // reporting a clean success over a file that is still sitting there.
      return { ok: true, warning: t("profile.oldFileLeft") };
    }
  }

  return { ok: true };
}
