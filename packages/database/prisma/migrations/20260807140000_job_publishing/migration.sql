-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- PUBLIC APPLICATION SUBMISSION — the suite's first write with no authenticated viewer.
--
-- Candidate/Application are RLS-protected and every policy reads app.current_* session variables.
-- An anonymous applicant has none, so a normal INSERT is (correctly) refused. Relaxing those
-- policies to admit anonymous writes would gut the whole model, so instead we expose exactly ONE
-- SECURITY DEFINER entry point: it runs as the table owner (bypassing RLS) and is ITSELF the
-- security boundary. Everything it guarantees is enforced here in SQL, where the app layer — or a
-- forged request — cannot route around it:
--
--   1. orgId is DERIVED FROM THE JOB, never supplied by the caller  → no cross-tenant writes.
--   2. The job must be OPEN *and* published                          → knowing/guessing a draft or
--      confidential req's id still gets you nothing.
--   3. The candidate is deduped on (orgId, email)                    → a returning applicant reuses
--      their record, which is what makes the talent pool coherent.
--   4. An EXISTING candidate's details are never overwritten         → someone who guesses a real
--      candidate's email cannot rewrite their phone/name; we only fill fields that are empty.
--   5. The duplicate case returns a bare sentinel, no data           → the endpoint can't be used to
--      probe who has already applied.
--   6. The APPLIED event is attributed to the SYSTEM user            → ApplicationEvent.actorId is
--      NOT NULL and an applicant has no User row; the pinned system user exists for exactly this.
--
-- Returns (result, application_id): ('OK', <id>) | ('DUPLICATE', <existing id>) | ('CLOSED', NULL).
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_submit_application(
  p_job_id      text,
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text DEFAULT NULL,
  p_source      text DEFAULT NULL,
  p_resume_key  text DEFAULT NULL,
  p_resume_name text DEFAULT NULL
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

  RETURN QUERY SELECT 'OK'::text, v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_submit_application(text, text, text, text, text, text, text, text) TO hris_app;

