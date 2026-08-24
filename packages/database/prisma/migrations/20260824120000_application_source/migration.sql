-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE INDEX "Application_orgId_source_idx" ON "Application"("orgId", "source");

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M1 — SOURCE ATTRIBUTION MOVES TO THE APPLICATION.
--
-- THE DEFECT. `source` lived only on "Candidate", and app_submit_application set it with
-- `COALESCE(source, p_source)` — fill-gaps-only, never overwritten. getSourceReport then did
-- `GROUP BY c.source`. So somebody who applied through the careers page in March and through a
-- LinkedIn campaign in August was counted as "Careers page" BOTH times, and the LinkedIn campaign
-- was reported as producing nobody. Nothing errored and nothing looked broken; the numbers were
-- simply wrong. That is the worst way for a reporting feature to fail, and every campaign feature
-- planned on top of it would have inherited the fault.
--
-- WHAT CHANGES. Attribution is now per-application. "Candidate".source is KEPT and re-defined as
-- FIRST TOUCH — how this person first entered our world — which is what the COALESCE was already
-- computing. Two different questions, both worth answering, so both are kept.
--
-- NO RLS CHANGE, and that is a decision rather than an omission: "Application" is already governed
-- by application_read → app_can_see_job("jobId"), which is exactly the scope an attribution figure
-- should have. Nothing about who may read a source changes.
--
-- WHAT THIS DOES TO ERASURE — it makes it stronger, and nothing here needed editing. app_erase_
-- candidate deliberately KEEPS "Candidate".source ("it describes a channel, not a person, and every
-- source-effectiveness figure on /reports depends on it"). That was an explicit exception carved
-- into a function whose whole job is destruction. Now that attribution lives on "Application" — a
-- table the erase function never touches at all — the reports survive an erasure BY CONSTRUCTION
-- rather than by an exception someone must remember not to break.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL — honest where the data is honest, NULL where it is not.
--
-- Copy the candidate's source down ONLY for candidates with exactly ONE application. That invents
-- nothing: with a single application, the candidate's source WAS that application's source.
--
-- Candidates with two or more applications are left NULL on purpose. Their stored source cannot say
-- which application it described, so choosing one would be the same fiction this migration exists to
-- end. summariseSources already reports a NULL source as "Unknown", which is the truthful answer:
-- we did not record it.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
UPDATE "Application" a
   SET source = c.source
  FROM "Candidate" c
 WHERE c.id = a."candidateId"
   AND c.source IS NOT NULL
   AND (SELECT count(*) FROM "Application" a2 WHERE a2."candidateId" = a."candidateId") = 1;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — REPLACED so a submission records its own source (M1).
--
-- Reproduced in full because a plpgsql body cannot be patched in place. The ONLY change from the
-- M10 (EEO) version is the marked line in the "Application" INSERT.
--
-- The SIGNATURE IS UNCHANGED — same twelve parameters, same types, same order — so CREATE OR REPLACE
-- is enough and the existing GRANT still applies. No new GRANT is issued below, deliberately: adding
-- one for an identical signature would be a no-op that implies the old one was somehow superseded.
--
-- Note what is NOT changed: step (4) still writes "Candidate".source with COALESCE. That is not
-- leftover code — it is precisely what makes that column mean FIRST TOUCH. The same p_source now
-- feeds two columns answering two different questions: "how did we first meet this person" and
-- "which channel produced this application".
-- ═════════════════════════════════════════════════════════════════════════════════════════════
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
    -- (4) Only fill gaps; never overwrite what an existing candidate already has on file. For
    --     `source` this is what makes the column mean FIRST TOUCH.
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
                             -- ⇩ M1: this submission's own attribution.
                             source,
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(),
          p_source,
          v_org_id, p_job_id, v_candidate_id);

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
