"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@hris/database";
import { createStorage } from "@hris/storage";
import {
  publicApplicationSchema,
  RESUME_MAX_BYTES,
  RESUME_EXTENSIONS,
  RESUME_MIME_TYPES,
} from "@hris/recruiting";
import { allowApplyAttempt } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n.server";

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
export async function submitApplication(jobId, _prevState, formData) {
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
    } catch {
      return { error: t("apply.failed") };
    }
  }

  // 5. The security boundary. A bare prisma call — no withViewer — because there is no viewer; the
  //    function itself decides what is allowed.
  let result;
  try {
    const rows = await prisma.$queryRaw`
      SELECT result, application_id FROM app_submit_application(
        ${jobId}, ${d.firstName}, ${d.lastName}, ${d.email},
        ${d.phone ?? null}, ${"Careers page"}, ${resumeKey}, ${resumeName})`;
    result = rows[0]?.result;
  } catch {
    if (resumeKey) await storage.remove(resumeKey).catch(() => {});
    return { error: t("apply.failed") };
  }

  // Don't leave an orphaned file behind for a submission that wasn't accepted.
  if (result !== "OK" && resumeKey) await storage.remove(resumeKey).catch(() => {});

  if (result === "DUPLICATE") return { error: t("apply.duplicate") };
  if (result === "CLOSED") return { error: t("apply.closed") };

  redirect(`/careers/${jobId}/applied`);
}
