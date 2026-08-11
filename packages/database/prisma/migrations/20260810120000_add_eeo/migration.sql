-- CreateEnum
CREATE TYPE "EeoGender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'DECLINED');

-- CreateEnum
CREATE TYPE "EeoEthnicity" AS ENUM ('HISPANIC_OR_LATINO', 'WHITE', 'BLACK_OR_AFRICAN_AMERICAN', 'ASIAN', 'NATIVE_HAWAIIAN_OR_PACIFIC_ISLANDER', 'AMERICAN_INDIAN_OR_ALASKA_NATIVE', 'TWO_OR_MORE_RACES', 'DECLINED');

-- CreateEnum
CREATE TYPE "EeoVeteranStatus" AS ENUM ('PROTECTED_VETERAN', 'NOT_A_VETERAN', 'DECLINED');

-- CreateEnum
CREATE TYPE "EeoDisabilityStatus" AS ENUM ('YES', 'NO', 'DECLINED');

-- CreateTable
CREATE TABLE "EeoResponse" (
    "id" TEXT NOT NULL,
    "gender" "EeoGender" NOT NULL DEFAULT 'DECLINED',
    "ethnicity" "EeoEthnicity" NOT NULL DEFAULT 'DECLINED',
    "veteranStatus" "EeoVeteranStatus" NOT NULL DEFAULT 'DECLINED',
    "disabilityStatus" "EeoDisabilityStatus" NOT NULL DEFAULT 'DECLINED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "EeoResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EeoResponse_applicationId_key" ON "EeoResponse"("applicationId");

-- CreateIndex
CREATE INDEX "EeoResponse_orgId_jobId_idx" ON "EeoResponse"("orgId", "jobId");

-- AddForeignKey
ALTER TABLE "EeoResponse" ADD CONSTRAINT "EeoResponse_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EeoResponse" ADD CONSTRAINT "EeoResponse_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EeoResponse" ADD CONSTRAINT "EeoResponse_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- EEO SELF-IDENTIFICATION (M10) — the suite's first table that the application role cannot read
-- AT ALL, by construction.
--
-- Every other table in this system answers "who may see this row?". This one answers "nobody",
-- and that is the entire feature. Demographic data collected for compliance reporting must be
-- provably unable to reach the people making hiring decisions — not "hidden in the UI", not
-- "filtered in the query", but unreachable, so that no future milestone can casually expose it by
-- adding an `include`.
--
-- Two mechanisms, deliberately both:
--   1. ENABLE ROW LEVEL SECURITY with NO POLICIES. Postgres RLS is default-DENY: a table with RLS
--      on and zero policies returns zero rows to every non-owner role, forever.
--   2. REVOKE ALL from hris_app. Belt and braces — and necessary here, because this schema's
--      ALTER DEFAULT PRIVILEGES (see the audit_append_only migration) automatically GRANTs new
--      tables to hris_app. Without this line the grant would silently arrive.
--
-- The only ways in are the two SECURITY DEFINER functions below: one writes a response as part of
-- a public application, the other returns AGGREGATE counts to HR_ADMIN. Neither can return an
-- individual's answers to anybody.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "EeoResponse" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "EeoResponse" FROM hris_app;

-- Whether the current viewer may read EEO aggregates at all.
--
-- This exists so the application can tell "you are not permitted" apart from "there is no data" —
-- the M7 lesson from the scorecard anchoring guard, where showing fewer rows without saying so
-- would have read as "nobody has reviewed yet", which is a lie. An empty compliance report that
-- silently means "you're not allowed" is the same failure.
--
-- HR_ADMIN only. Not RECRUITER, not HR_GENERALIST, and emphatically not a hiring manager: the
-- narrower the audience, the smaller the chance this data ever touches a hiring conversation.
CREATE OR REPLACE FUNCTION app_can_read_eeo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- withViewer sets these to the EMPTY STRING (not NULL) when a viewer field is missing, so both
  -- "no session vars at all" and "a session with no org" have to be rejected the same way.
  SELECT current_setting('app.current_role', true) = 'HR_ADMIN'
     AND COALESCE(current_setting('app.current_org_id', true), '') <> '';
$$;

-- Aggregate EEO counts for the caller's organisation, optionally narrowed to one requisition.
--
-- Returns LONG format — (dimension, value, responses) — so one function answers all four questions
-- and adding a fifth later needs no new signature. Raw counts are returned; small-cell suppression
-- is applied in @hris/recruiting where the threshold is tunable and unit-testable. That split is
-- deliberate: the ACCESS boundary is this function's role gate, while suppression is a
-- presentation ethic. Encoding an ethic in SQL makes it untestable and hard to tune; encoding
-- access in JavaScript makes it bypassable. Each belongs where it can be enforced.
--
-- Because DECLINED is a stored value rather than a null, every dimension sums to the same total —
-- so the caller can derive the response count from any one of them.
CREATE OR REPLACE FUNCTION app_eeo_summary(p_job_id text DEFAULT NULL)
RETURNS TABLE (dimension text, value text, responses int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text := current_setting('app.current_org_id', true);
BEGIN
  IF NOT app_can_read_eeo() THEN
    RETURN; -- zero rows; the caller asks app_can_read_eeo() to learn why
  END IF;

  RETURN QUERY
    SELECT 'gender'::text, e.gender::text, count(*)::int
      FROM "EeoResponse" e
     WHERE e."orgId" = v_org AND (p_job_id IS NULL OR e."jobId" = p_job_id)
     GROUP BY e.gender
    UNION ALL
    SELECT 'ethnicity'::text, e.ethnicity::text, count(*)::int
      FROM "EeoResponse" e
     WHERE e."orgId" = v_org AND (p_job_id IS NULL OR e."jobId" = p_job_id)
     GROUP BY e.ethnicity
    UNION ALL
    SELECT 'veteranStatus'::text, e."veteranStatus"::text, count(*)::int
      FROM "EeoResponse" e
     WHERE e."orgId" = v_org AND (p_job_id IS NULL OR e."jobId" = p_job_id)
     GROUP BY e."veteranStatus"
    UNION ALL
    SELECT 'disabilityStatus'::text, e."disabilityStatus"::text, count(*)::int
      FROM "EeoResponse" e
     WHERE e."orgId" = v_org AND (p_job_id IS NULL OR e."jobId" = p_job_id)
     GROUP BY e."disabilityStatus";
END;
$$;

GRANT EXECUTE ON FUNCTION app_can_read_eeo() TO hris_app;
GRANT EXECUTE ON FUNCTION app_eeo_summary(text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — REPLACED to carry the four voluntary EEO answers.
--
-- ⚠️ The parameter list changed, so the old function must be DROPped by its exact signature and
-- recreated; adding defaulted parameters alone would leave two overloads and make every 8-argument
-- call ambiguous. Everything the original guaranteed (org derived from the job, OPEN+published
-- only, dedupe on (org,email), never overwrite an existing candidate, bare sentinel on duplicate,
-- SYSTEM actor on the event) is unchanged — see the job_publishing migration for that reasoning.
--
-- What is new:
--   7. The EEO response is written ONLY on the OK path, inside the same transaction as the
--      application. Never on DUPLICATE — otherwise a stranger who guessed an email could overwrite
--      a real applicant's demographic answers.
--   8. An unrecognised enum value falls back to DECLINED instead of raising. A malformed EEO field
--      must never cost someone their job application: the answer is voluntary, the application is
--      not. (Zod validates these app-side too; this is the boundary being independently safe.)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS app_submit_application(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION app_submit_application(
  p_job_id          text,
  p_first_name      text,
  p_last_name       text,
  p_email           text,
  p_phone           text DEFAULT NULL,
  p_source          text DEFAULT NULL,
  p_resume_key      text DEFAULT NULL,
  p_resume_name     text DEFAULT NULL,
  p_eeo_gender      text DEFAULT NULL,
  p_eeo_ethnicity   text DEFAULT NULL,
  p_eeo_veteran     text DEFAULT NULL,
  p_eeo_disability  text DEFAULT NULL
)
RETURNS TABLE (result text, application_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       text;
  v_email        text := lower(btrim(p_email));
  v_candidate_id text;
  v_existing_id  text;
  v_app_id       text;
  v_system_user  text := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- (1)+(2) Derive the org from the job, and only for a job that is genuinely on offer.
  SELECT j."orgId" INTO v_org_id
  FROM "Job" j
  WHERE j.id = p_job_id AND j.status = 'OPEN' AND j."publishedAt" IS NOT NULL;

  IF v_org_id IS NULL THEN
    RETURN QUERY SELECT 'CLOSED'::text, NULL::text;
    RETURN;
  END IF;

  -- (3) Dedupe the person on (org, email).
  SELECT c.id INTO v_candidate_id
  FROM "Candidate" c
  WHERE c."orgId" = v_org_id AND lower(c.email) = v_email;

  IF v_candidate_id IS NULL THEN
    v_candidate_id := gen_random_uuid()::text;
    INSERT INTO "Candidate" (id, "firstName", "lastName", email, phone, source,
                             "resumeKey", "resumeFileName", "createdAt", "updatedAt", "orgId")
    VALUES (v_candidate_id, p_first_name, p_last_name, v_email, p_phone, p_source,
            p_resume_key, p_resume_name, now(), now(), v_org_id);
  ELSE
    -- (4) Only fill gaps; never overwrite what an existing candidate already has on file.
    UPDATE "Candidate"
       SET phone            = COALESCE(phone, p_phone),
           source           = COALESCE(source, p_source),
           "resumeKey"      = COALESCE("resumeKey", p_resume_key),
           "resumeFileName" = COALESCE("resumeFileName", p_resume_name),
           "updatedAt"      = now()
     WHERE id = v_candidate_id;
  END IF;

  -- (5) Already applied to THIS job? Say so, and nothing more.
  SELECT a.id INTO v_existing_id
  FROM "Application" a
  WHERE a."jobId" = p_job_id AND a."candidateId" = v_candidate_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_existing_id;
    RETURN;
  END IF;

  v_app_id := gen_random_uuid()::text;
  INSERT INTO "Application" (id, stage, "appliedAt", "createdAt", "updatedAt",
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(), v_org_id, p_job_id, v_candidate_id);

  -- (6) The append-only trail starts here, attributed to the system actor.
  INSERT INTO "ApplicationEvent" (id, "fromStage", "toStage", "occurredAt",
                                  "applicationId", "jobId", "actorId")
  VALUES (gen_random_uuid()::text, NULL, 'APPLIED', now(), v_app_id, p_job_id, v_system_user);

  -- (7)+(8) The voluntary EEO answers. Unrecognised input degrades to DECLINED rather than raising.
  INSERT INTO "EeoResponse" (id, gender, ethnicity, "veteranStatus", "disabilityStatus",
                             "submittedAt", "orgId", "applicationId", "jobId")
  VALUES (
    gen_random_uuid()::text,
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoGender")) x
               WHERE x::text = p_eeo_gender), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoEthnicity")) x
               WHERE x::text = p_eeo_ethnicity), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoVeteranStatus")) x
               WHERE x::text = p_eeo_veteran), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoDisabilityStatus")) x
               WHERE x::text = p_eeo_disability), 'DECLINED'),
    now(), v_org_id, v_app_id, p_job_id);

  RETURN QUERY SELECT 'OK'::text, v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_submit_application(
  text, text, text, text, text, text, text, text, text, text, text, text) TO hris_app;
