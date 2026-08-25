"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@hris/database";
import { createStorage } from "@hris/storage";
import {
  publicApplicationSchema,
  eeoResponseSchema,
  employmentListSchema,
  educationListSchema,
  consentSchema,
  validateAnswers,
  monthToDate,
  PRIVACY_POLICY_VERSION,
  RESUME_MAX_BYTES,
  RESUME_EXTENSIONS,
  RESUME_MIME_TYPES,
} from "@hris/recruiting";
import { getT } from "@/lib/i18n.server";
import { getJobQuestions } from "@/lib/queries";
import { allowApplyAttempt } from "@/lib/rate-limit";

const storage = createStorage();

// The real apply flow (M6) — this app is the front door now.
//
// Layered exactly like the ATS careers action it supersedes, cheapest rejection first, because the
// caller is still an anonymous stranger even when they happen to be signed in:
//   1. honeypot (free) → 2. IP rate limit (one Redis op) → 3. Zod → 4. file checks → 5. the DB.
//
// ⚠️ BEING SIGNED IN CHANGES NOTHING ABOUT AUTHORIZATION HERE. A session only prefills the form; the
// submission is still resolved by EMAIL inside app_submit_application, exactly as an anonymous one
// is. Trusting the session to identify the candidate would mean two different ways to say who is
// applying, and the anonymous one has to work regardless — so there is only one.
export async function submitApplication(jobId, sourceSlug, _prevState, formData) {
  const t = await getT();

  // 1. Honeypot — same field name and same silent success as the ATS flow. Telling a bot it was
  //    detected only teaches it to try again without the field.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect(`/jobs/${jobId}/applied`);
  }

  // 2. Per-IP throttle (a transparent no-op when Upstash is unconfigured).
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  if (!(await allowApplyAttempt(ip))) return { error: t("apply.rateLimited") };

  // 3a. The core fields.
  const parsed = publicApplicationSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("apply.invalid") };
  const d = parsed.data;

  // 3b. CONSENT. A literal `true`, so an unchecked box fails loudly rather than silently recording
  //     a consent nobody gave. This is the one field where a quiet default would be worse than an
  //     error message.
  if (!consentSchema.safeParse(formData.get("consent") === "on").success) {
    return { error: t("apply.consentRequired") };
  }

  // 3c. Work history and education. The form posts JSON so repeatable rows survive a round trip
  //     without inventing a naming convention like `employer[3]` that both sides must agree on.
  let employment;
  let education;
  try {
    employment = employmentListSchema.parse(JSON.parse(formData.get("employment") || "[]"));
    education = educationListSchema.parse(JSON.parse(formData.get("education") || "[]"));
  } catch (e) {
    // A Zod issue has a readable message; a JSON.parse failure does not, and a stranger should not
    // be shown a parser error either way.
    return { error: e?.issues?.[0]?.message ?? t("apply.invalid") };
  }

  // 3c-bis. The req's SCREENING QUESTIONS (M6b). Answers arrive as `answer:<questionId>` fields, so
  //     the form needs no naming convention beyond the id the server already gave it.
  //
  //     ⚠️ Validated against the questions the JOB actually asks, re-read here rather than trusted
  //     from the form — otherwise a tampered submission could answer questions from another req.
  //     This produces a readable message next to the right question; app_submit_application
  //     independently refuses a missing required answer and discards foreign ones, because a public
  //     endpoint cannot rely on its own form having run.
  const questions = await getJobQuestions(jobId);
  const rawAnswers = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("answer:")) rawAnswers[key.slice("answer:".length)] = String(value);
  }
  const validated = validateAnswers(questions, rawAnswers);
  if (!validated.ok) return { error: validated.error };

  // 3d. Voluntary EEO — coerced to DECLINED rather than throwing, because a demographic question
  //     nobody had to answer must never be able to fail someone's application.
  const eeo = eeoResponseSchema.parse({
    gender: formData.get("eeoGender") || undefined,
    ethnicity: formData.get("eeoEthnicity") || undefined,
    veteranStatus: formData.get("eeoVeteranStatus") || undefined,
    disabilityStatus: formData.get("eeoDisabilityStatus") || undefined,
  });

  // 4. Résumé: validated BEFORE a byte is stored, key generated server-side from a UUID so a
  //    malicious filename can never influence the storage path.
  let resumeKey = null;
  let resumeName = null;
  const file = formData.get("resume");
  if (file && typeof file === "object" && file.size > 0) {
    if (file.size > RESUME_MAX_BYTES) return { error: t("apply.fileTooLarge") };
    const ext = (file.name?.split(".").pop() ?? "").toLowerCase();
    if (!RESUME_MIME_TYPES.includes(file.type) || !RESUME_EXTENSIONS.includes(ext)) {
      return { error: t("apply.fileType") };
    }
    resumeKey = `resumes/${randomUUID()}.${ext}`;
    resumeName = file.name?.slice(0, 200) ?? null;
    try {
      await storage.put(resumeKey, Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      console.error("[apply] resume upload failed", { key: resumeKey, error: e });
      return { error: t("apply.failed") };
    }
  }

  // Month strings → the timestamps the database stores, and drop the empty end month that means
  // "still there" so it lands as NULL rather than an empty string cast.
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

  // 5. The boundary. ONE call, so candidate, application, event, EEO, profile, snapshots and consent
  //    all land together or not at all — a follow-up write would leave half-applications behind.
  let result;
  try {
    const rows = await prisma.$queryRaw`
      SELECT result, application_id FROM app_submit_application(
        ${jobId}, ${d.firstName}, ${d.lastName}, ${d.email},
        ${d.phone ?? null}, ${sourceSlug || "careers-page"}, ${resumeKey}, ${resumeName},
        ${eeo.gender}, ${eeo.ethnicity}, ${eeo.veteranStatus}, ${eeo.disabilityStatus},
        ${JSON.stringify(employmentRows)}::jsonb, ${JSON.stringify(educationRows)}::jsonb,
        ${PRIVACY_POLICY_VERSION}, ${JSON.stringify(validated.answers)}::jsonb)`;
    result = rows[0]?.result;
  } catch (e) {
    console.error("[apply] submission failed", e);
    if (resumeKey) await storage.remove(resumeKey).catch(() => {});
    return { error: t("apply.failed") };
  }

  // Never leave an orphaned file behind for a submission that wasn't accepted.
  if (result !== "OK" && resumeKey) await storage.remove(resumeKey).catch(() => {});

  if (result === "MISSING_ANSWERS") return { error: t("apply.missingAnswers") };
  if (result === "DUPLICATE") return { error: t("apply.duplicate") };
  if (result === "CLOSED") return { error: t("apply.closed") };

  redirect(`/jobs/${jobId}/applied`);
}
