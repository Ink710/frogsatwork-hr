"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@hris/database";
import { createStorage } from "@hris/storage";
import { deliverCandidateStageEmail } from "@hris/notifications";
import {
  publicApplicationSchema,
  erasureRequestSchema,
  eeoResponseSchema,
  RESUME_MAX_BYTES,
  RESUME_EXTENSIONS,
  RESUME_MIME_TYPES,
} from "@hris/recruiting";
import { allowApplyAttempt, allowErasureAttempt } from "@/lib/rate-limit";
import { getT, getLocale } from "@/lib/i18n.server";
import { portalUrl } from "@/lib/portal-url";

const storage = createStorage();

// Public application submission — the only write in the suite with NO authenticated viewer.
//
// Layered on purpose, cheapest rejection first, so abuse is discarded before it costs anything:
//   1. honeypot   (free)      2. IP rate limit (one Redis op)   3. Zod
//   4. file checks (before a byte is stored)                    5. the DB security boundary
//
// The real authorization lives in app_submit_application (SECURITY DEFINER): it derives the org from
// the job, refuses anything not OPEN+published, dedupes the candidate, never overwrites an existing
// candidate's details, and reveals nothing about existing records. Everything here is defence in
// depth in FRONT of that — none of it is load-bearing on its own.
export async function submitApplication(jobId, sourceSlug, _prevState, formData) {
  const t = await getT();

  // 1. Honeypot: a field positioned off-screen that a human never fills. Bots fill everything.
  //    We return the SAME success outcome rather than an error — telling a bot it was detected just
  //    teaches it to try again without the field.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect(`/careers/${jobId}/applied`);
  }

  // 2. Per-IP rate limit (env-gated: a transparent no-op when Upstash isn't configured, exactly like
  //    login). On Vercel the first x-forwarded-for hop is the real client.
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  if (!(await allowApplyAttempt(ip))) return { error: t("apply.rateLimited") };

  // 3. Validate the human-supplied fields.
  const parsed = publicApplicationSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("apply.invalid") };
  const d = parsed.data;

  // 3b. The VOLUNTARY EEO section. Parsed with a schema that coerces anything unrecognised to
  //     DECLINED and never throws — a demographic question the applicant didn't have to answer must
  //     not be able to fail their application. Note there is no branch here on whether they answered:
  //     "declined" is recorded exactly like any other answer, because a refusal rate is itself a
  //     figure the compliance report needs.
  const eeo = eeoResponseSchema.parse({
    gender: formData.get("eeoGender") || undefined,
    ethnicity: formData.get("eeoEthnicity") || undefined,
    veteranStatus: formData.get("eeoVeteranStatus") || undefined,
    disabilityStatus: formData.get("eeoDisabilityStatus") || undefined,
  });

  // 4. Résumé: validate BEFORE storing. The object key is server-generated from a UUID, so a
  //    malicious filename can never influence the storage path (LocalStorage also rejects "..").
  //    Only the extension is carried over, and only from an allow-list.
  let resumeKey = null;
  let resumeName = null;
  const file = formData.get("resume");
  if (file && typeof file === "object" && file.size > 0) {
    if (file.size > RESUME_MAX_BYTES) return { error: t("apply.fileTooLarge") };
    const ext = (file.name?.split(".").pop() ?? "").toLowerCase();
    const typeOk = RESUME_MIME_TYPES.includes(file.type);
    const extOk = RESUME_EXTENSIONS.includes(ext);
    if (!typeOk || !extOk) return { error: t("apply.fileType") };

    resumeKey = `resumes/${randomUUID()}.${ext}`;
    resumeName = file.name?.slice(0, 200) ?? null; // stored for display only, never used as a path
    try {
      await storage.put(resumeKey, Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      // LOG IT. The applicant gets a deliberately vague message — a stranger must not learn anything
      // about our infrastructure from a failed upload — but swallowing the cause entirely left
      // production genuinely undebuggable: a misconfigured storage driver looked identical to a
      // corrupt file, with nothing in the logs either way. The operator needs the real error.
      console.error("[careers] resume upload failed", { key: resumeKey, error: e });
      return { error: t("apply.failed") };
    }
  }

  // 5. The security boundary. A bare prisma call — no withViewer — because there is no viewer; the
  //    function itself decides what is allowed.
  let result;
  let eventId;
  let locale;
  try {
    // M2: the source argument is a campaign SLUG now, not a display label. A tracked link supplies
    // one; an untracked visit to the careers site falls back to the built-in `careers-page`
    // campaign, which is what that visit genuinely is.
    //
    // Passed through unvalidated ON PURPOSE — the function resolves it against the live registry in
    // this job's own org and discards anything unrecognised, so a Zod check here would only
    // duplicate a rule that has to live in the database anyway (the public path is not the only
    // caller). What it must never do is refuse the application: a mangled marketing link is our
    // bookkeeping problem, never the applicant's.
    const source = typeof sourceSlug === "string" && sourceSlug.trim() ? sourceSlug.trim() : "careers-page";
    locale = await getLocale();

    // M8: one jsonb payload instead of twelve positional arguments. This fallback still sends no
    // employment, education, consent or answers — those belong to app 4's richer flow — and omitting
    // the keys means exactly what it meant before: not submitted, so nothing is written.
    //
    // `locale` IS captured here. /careers is a public page, so the cookie is the applicant's own,
    // and someone who applies through the fallback deserves to be written to in their own language
    // just as much as someone who uses the front door.
    const payload = {
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone ?? null,
      source,
      resumeKey,
      resumeName,
      locale,
      eeo: {
        gender: eeo.gender,
        ethnicity: eeo.ethnicity,
        veteran: eeo.veteranStatus,
        disability: eeo.disabilityStatus,
      },
    };
    const rows = await prisma.$queryRaw`
      SELECT result, application_id, event_id
      FROM app_submit_application(${jobId}, ${JSON.stringify(payload)}::jsonb)`;
    result = rows[0]?.result;
    eventId = rows[0]?.event_id;
  } catch {
    if (resumeKey) await storage.remove(resumeKey).catch(() => {});
    return { error: t("apply.failed") };
  }

  // Don't leave an orphaned file behind for a submission that wasn't accepted.
  if (result !== "OK" && resumeKey) await storage.remove(resumeKey).catch(() => {});

  if (result === "DUPLICATE") return { error: t("apply.duplicate") };
  if (result === "CLOSED") return { error: t("apply.closed") };

  // M8: the receipt. Sent AFTER the doorway commits, and never allowed to affect the outcome — the
  // application is accepted whether or not we manage to acknowledge it.
  //
  // ⚠️ `redirect()` throws to unwind, so this must come BEFORE it. Anything after the redirect call
  // is unreachable.
  await sendReceipt({ eventId, jobId, email: d.email, firstName: d.firstName, locale });

  redirect(`/careers/${jobId}/applied`);
}

// The receipt is keyed on the APPLIED event the doorway just created — which is why that function
// returns `event_id` at all. The apply path is anonymous and "ApplicationEvent" is RLS'd, so it
// cannot read the event back; without the returned id there would be nothing to make the send
// idempotent, and a resubmitted form would acknowledge the same application twice.
async function sendReceipt({ eventId, jobId, email, firstName, locale }) {
  if (!eventId) return;
  try {
    const [job] = await prisma.$queryRaw`SELECT title FROM app_public_jobs() WHERE id = ${jobId}`;
    await deliverCandidateStageEmail({
      db: prisma,
      eventId,
      stageKey: "APPLIED",
      to: email,
      firstName,
      jobTitle: job?.title ?? "",
      locale,
      portalUrl: portalUrl(),
    });
  } catch (e) {
    // Belt and braces: deliverCandidateStageEmail does not throw, but nothing about acknowledging an
    // application is worth failing a successful submission over.
    console.error("[careers] receipt failed", { eventId, error: e });
  }
}

// ── The public "erase my data" request (M10) ─────────────────────────────────────────────────────
//
// The GDPR right to erasure needs a door a data subject can actually walk through, so this sits
// alongside the careers site with no account required. What it must NOT do is erase anything:
// anyone can type any address, and a request that executes itself is a way to delete a rival
// candidate's record.
//
// It is also, deliberately, a DEAD END for anyone probing it. Whatever happens inside — a match, no
// match, a duplicate request — this returns the same neutral confirmation, because "we have no
// record of that address" is itself information about someone. The same discipline as the bare
// DUPLICATE sentinel on the apply endpoint; here it matters more, because the question being asked
// is "is this person in your database?".
export async function requestErasure(_prevState, formData) {
  const t = await getT();

  // Honeypot first (free), same field name and same silent-success as the apply form.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect("/careers/erasure/submitted");
  }

  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  if (!(await allowErasureAttempt(ip))) return { error: t("erasure.rateLimited") };

  const parsed = erasureRequestSchema.safeParse({
    email: formData.get("email"),
    reason: formData.get("reason") || undefined,
  });
  // The one thing worth reporting back: a malformed address. Telling someone their email is invalid
  // reveals nothing about our data, and silently swallowing it would strand a real request.
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("erasure.invalid") };

  try {
    // Bare prisma — there is no viewer. app_request_erasure is the boundary: it derives the org from
    // whatever candidate the address matches, writes nothing when there's no match, and always
    // answers 'OK'.
    await prisma.$queryRaw`SELECT app_request_erasure(${parsed.data.email}, ${parsed.data.reason ?? null})`;
  } catch {
    // Even a failure must not become a signal, so this reports a generic problem rather than
    // anything that could be read as "that address exists / doesn't exist".
    return { error: t("erasure.failed") };
  }

  redirect("/careers/erasure/submitted");
}
