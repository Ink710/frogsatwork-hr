-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT');

-- CreateTable
CREATE TABLE "JobQuestion" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "promptSnapshot" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobQuestion_jobId_position_idx" ON "JobQuestion"("jobId", "position");
CREATE UNIQUE INDEX "ApplicationAnswer_applicationId_questionId_key" ON "ApplicationAnswer"("applicationId", "questionId");
CREATE INDEX "ApplicationAnswer_jobId_idx" ON "ApplicationAnswer"("jobId");

-- AddForeignKey
ALTER TABLE "JobQuestion" ADD CONSTRAINT "JobQuestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "JobQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M6b — PER-JOB SCREENING QUESTIONS.
--
-- RLS mirrors InterviewRound / JobCompetency exactly: a question is visible to whoever can SEE the
-- req and editable by whoever can MANAGE it. Nothing new to reason about.
--
-- ⚠️ ANSWERS ARE READ-ONLY TO THE APP ROLE. An answer is the applicant's own words; the hiring team
-- reads them, nobody edits them. Same append-only reasoning as ApplicationEvent and the audit log.
-- app_erase_candidate can still remove them because it is SECURITY DEFINER and runs as the owner,
-- which is precisely the split those REVOKEs are designed to preserve.
--
-- NO EXPLICIT GRANT for the tables: ALTER DEFAULT PRIVILEGES (audit_append_only) covers new ones.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "JobQuestion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_question_read ON "JobQuestion" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY job_question_write ON "JobQuestion" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

ALTER TABLE "ApplicationAnswer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_answer_read ON "ApplicationAnswer" FOR SELECT
  USING (app_can_see_job("jobId"));
REVOKE UPDATE, DELETE ON "ApplicationAnswer" FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_public_job_questions — the questions a STRANGER may see, for the public apply form.
--
-- Needed because "JobQuestion" is gated by app_can_see_job, which asks "are you on this hiring
-- team". An applicant is nobody, so a bare read returns nothing — the same wall every other public
-- surface hit.
--
-- Gated identically to app_public_jobs(): OPEN *and* published. An unadvertised req's questions are
-- exactly as invisible as the req itself, so this cannot become a way to inspect a confidential
-- search. Archived questions are excluded: they are kept to explain old answers, not to be asked.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_public_job_questions(p_job_id text)
RETURNS TABLE (
  id       text,
  prompt   text,
  type     text,
  required boolean,
  options  text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.prompt, q.type::text, q.required, q.options
  FROM "JobQuestion" q
  JOIN "Job" j ON j.id = q."jobId"
  WHERE q."jobId" = p_job_id
    AND q."archivedAt" IS NULL
    AND j.status = 'OPEN'
    AND j."publishedAt" IS NOT NULL
  ORDER BY q.position ASC, q."createdAt" ASC
$$;

GRANT EXECUTE ON FUNCTION app_public_job_questions(text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — DROPPED and RECREATED a THIRD time, now taking p_answers (M6b).
--
-- Same reason as M6: adding a parameter changes the signature, so CREATE OR REPLACE would leave the
-- old function standing beside the new one and make the existing call ambiguous.
--
-- ⚠️ SMELL WORTH NAMING: this function now takes SIXTEEN parameters. The next change should collapse
-- the whole payload into one jsonb submission argument rather than adding a seventeenth. Not done
-- here because it would rewrite the ATS careers call site for zero behaviour change, and this
-- milestone already touches two apps.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS app_submit_application(text, text, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION app_submit_application(p_job_id text, p_first_name text, p_last_name text, p_email text, p_phone text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_resume_key text DEFAULT NULL::text, p_resume_name text DEFAULT NULL::text, p_eeo_gender text DEFAULT NULL::text, p_eeo_ethnicity text DEFAULT NULL::text, p_eeo_veteran text DEFAULT NULL::text, p_eeo_disability text DEFAULT NULL::text, p_employment jsonb DEFAULT NULL::jsonb, p_education jsonb DEFAULT NULL::jsonb, p_consent_version text DEFAULT NULL::text,
  p_answers jsonb DEFAULT NULL)
 RETURNS TABLE(result text, application_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org_id       text;
  v_email        text := lower(btrim(p_email));
  v_candidate_id text;
  v_existing_id  text;
  v_app_id       text;
  v_campaign_id  text;
  v_source_label text;
  v_missing      integer;
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

  -- (0a) M6b: REQUIRED ANSWERS. Checked here, before a single row is written, so a submission that
  --      cannot be accepted never creates a half-application.
  --
  --      ⚠️ ENFORCED IN THE DATABASE, NOT JUST THE FORM. This is a public endpoint; a "required"
  --      field that only the browser enforces is not required at all. Same posture as M2's campaign
  --      slugs: the app layer validates for a good error message, the function decides.
  SELECT count(*) INTO v_missing
  FROM "JobQuestion" q
  WHERE q."jobId" = p_job_id
    AND q.required
    AND q."archivedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) a
      WHERE a->>'questionId' = q.id AND btrim(COALESCE(a->>'value', '')) <> ''
    );

  IF v_missing > 0 THEN
    RETURN QUERY SELECT 'MISSING_ANSWERS'::text, NULL::text;
    RETURN;
  END IF;

  -- (0) M2: resolve p_source as a campaign SLUG within THIS job's org. Both outputs stay NULL when
  --     there is no live campaign by that slug, which is what discards unrecognised input. Scoping
  --     to v_org_id (derived from the job, never supplied by the caller) also means a slug from one
  --     org can never attribute an application in another.
  IF p_source IS NOT NULL THEN
    SELECT c.id, c.name INTO v_campaign_id, v_source_label
    FROM "Campaign" c
    WHERE c."orgId" = v_org_id
      AND c.slug = lower(btrim(p_source))
      AND c."archivedAt" IS NULL;
  END IF;

  -- (3) Dedupe the person on (org, email).
  SELECT c.id INTO v_candidate_id
  FROM "Candidate" c
  WHERE c."orgId" = v_org_id AND lower(c.email) = v_email;

  IF v_candidate_id IS NULL THEN
    v_candidate_id := gen_random_uuid()::text;
    INSERT INTO "Candidate" (id, "firstName", "lastName", email, phone, source,
                             "resumeKey", "resumeFileName", "createdAt", "updatedAt", "orgId")
    VALUES (v_candidate_id, p_first_name, p_last_name, v_email, p_phone, v_source_label,
            p_resume_key, p_resume_name, now(), now(), v_org_id);
  ELSE
    -- (4) Only fill gaps; never overwrite what an existing candidate already has on file. For
    --     `source` this is what makes the column mean FIRST TOUCH — now a resolved campaign name
    --     rather than whatever text arrived.
    UPDATE "Candidate"
       SET phone            = COALESCE(phone, p_phone),
           source           = COALESCE(source, v_source_label),
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
                             source, "campaignId",
                             -- ⇩ M6: frozen copies of what was submitted.
                             "employmentSnapshot", "educationSnapshot",
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(),
          v_source_label, v_campaign_id,
          p_employment, p_education,
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

  -- ▼ M6: the PROFILE and the CONSENT record.
  --
  -- Submitting REPLACES the profile with what was just submitted — that is what "profile master,
  -- snapshot at submit" means in practice: one form, two destinations. The application already has
  -- its frozen copy above, so rewriting the profile cannot disturb anything under review.
  --
  -- Delete-then-insert rather than a diff: the form posts the whole history every time, so there is
  -- no partial update to reconcile, and matching rows up by identity would invent an editing model
  -- the UI does not have.
  IF p_employment IS NOT NULL THEN
    DELETE FROM "CandidateEmployment" WHERE "candidateId" = v_candidate_id;
    INSERT INTO "CandidateEmployment"
      (id, employer, title, "startDate", "endDate", summary, position,
       "createdAt", "updatedAt", "candidateId")
    SELECT gen_random_uuid()::text,
           e->>'employer', e->>'title',
           (e->>'startDate')::timestamp(3),
           NULLIF(e->>'endDate','')::timestamp(3),
           NULLIF(e->>'summary',''),
           COALESCE((e->>'position')::int, ord::int),
           now(), now(), v_candidate_id
    FROM jsonb_array_elements(p_employment) WITH ORDINALITY AS t(e, ord);
  END IF;

  IF p_education IS NOT NULL THEN
    DELETE FROM "CandidateEducation" WHERE "candidateId" = v_candidate_id;
    INSERT INTO "CandidateEducation"
      (id, institution, qualification, "startDate", "endDate", position,
       "createdAt", "updatedAt", "candidateId")
    SELECT gen_random_uuid()::text,
           e->>'institution', e->>'qualification',
           NULLIF(e->>'startDate','')::timestamp(3),
           NULLIF(e->>'endDate','')::timestamp(3),
           COALESCE((e->>'position')::int, ord::int),
           now(), now(), v_candidate_id
    FROM jsonb_array_elements(p_education) WITH ORDINALITY AS t(e, ord);
  END IF;

  -- Consent is recorded against the APPLICATION, not the person: it attests to this submission
  -- under a named policy version. NULL means the caller did not collect it (the ATS careers page,
  -- which predates the consent flow) — recording a consent nobody gave would be worse than none.
  IF p_consent_version IS NOT NULL THEN
    INSERT INTO "ApplicationConsent" (id, "policyVersion", "acceptedAt", "applicationId", "jobId")
    VALUES (gen_random_uuid()::text, p_consent_version, now(), v_app_id, p_job_id);
  END IF;
  -- ▲ END M6

  -- ▼ M6b: the answers.
  --
  -- The JOIN to "JobQuestion" is the filter, and it is doing real work: an answer whose questionId
  -- belongs to a DIFFERENT job, or to an ARCHIVED question, simply does not join and is silently
  -- discarded. Same discard-don't-record posture as an unrecognised campaign slug — a caller cannot
  -- smuggle arbitrary rows in by inventing ids.
  --
  -- The prompt is SNAPSHOTTED here, so rewording the question later cannot change what a past
  -- applicant appears to have been asked.
  IF p_answers IS NOT NULL THEN
    INSERT INTO "ApplicationAnswer" (id, "promptSnapshot", value, "createdAt",
                                     "applicationId", "questionId", "jobId")
    SELECT gen_random_uuid()::text, q.prompt, btrim(a->>'value'), now(),
           v_app_id, q.id, p_job_id
    FROM jsonb_array_elements(p_answers) a
    JOIN "JobQuestion" q
      ON q.id = a->>'questionId'
     AND q."jobId" = p_job_id
     AND q."archivedAt" IS NULL
    WHERE btrim(COALESCE(a->>'value', '')) <> '';
  END IF;
  -- ▲ END M6b

  RETURN QUERY SELECT 'OK'::text, v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_submit_application(
  text, text, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, text, jsonb) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED so an erasure also destroys the answers (M6b). Reproduced from the
-- LIVE definition; the only change is the marked block. The erasure-registry rule again: a new table
-- holding applicant PII is handled here in the SAME migration that creates it.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_erase_candidate(p_candidate_id text, p_note text DEFAULT NULL::text)
 RETURNS TABLE(result text, resume_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org        text := current_setting('app.current_org_id', true);
  v_actor      text := NULLIF(current_setting('app.current_employee_id', true), '');
  v_candidate  record;
  v_resume_key text;
BEGIN
  IF NOT app_can_manage_erasure() THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text;
    RETURN;
  END IF;

  SELECT c.id, c."resumeKey", c."anonymisedAt" INTO v_candidate
  FROM "Candidate" c
  WHERE c.id = p_candidate_id AND c."orgId" = v_org;

  IF v_candidate.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;

  IF v_candidate."anonymisedAt" IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_ERASED'::text, NULL::text;
    RETURN;
  END IF;

  -- The retention rule wins over the erasure right.
  IF EXISTS (
    SELECT 1 FROM "Application" a
    WHERE a."candidateId" = p_candidate_id AND a."hiredEmployeeId" IS NOT NULL
  ) THEN
    RETURN QUERY SELECT 'HIRED'::text, NULL::text;
    RETURN;
  END IF;

  v_resume_key := v_candidate."resumeKey";

  -- ▼ CHANGED IN M16 — the lead mark and its note die with the identity. See the note above.
  UPDATE "Candidate"
     SET "firstName"         = 'Erased',
         "lastName"          = 'candidate',
         email               = 'erased+' || gen_random_uuid()::text || '@anonymised.invalid',
         phone               = NULL,
         "resumeKey"         = NULL,
         "resumeFileName"    = NULL,
         "leadMarkedAt"      = NULL,
         "leadMarkedById"    = NULL,
         "leadNote"          = NULL,
         "anonymisedAt"      = now(),
         "anonymisedById"    = v_actor,
         "anonymisationNote" = NULLIF(btrim(COALESCE(p_note, '')), ''),
         "updatedAt"         = now()
   WHERE id = p_candidate_id;

  -- ▼ M4: the portal login goes with the identity. See the note above for why DELETE, not blank.
  DELETE FROM "CandidateAccount" WHERE "candidateId" = p_candidate_id;
  -- ▲ END M4 change

  -- ▼ M6: the PROFILE and the submitted SNAPSHOTS.
  --
  -- DELETED, not blanked. Everywhere else this function keeps the PROCESS and destroys the identity
  -- — stages, ratings, dates and EEO answers all survive because they are facts about what happened.
  -- An employment history is not a fact about our process at all: it is the person, and it names
  -- third parties (their employers) who never applied to us.
  DELETE FROM "CandidateEmployment" WHERE "candidateId" = p_candidate_id;
  DELETE FROM "CandidateEducation"  WHERE "candidateId" = p_candidate_id;

  -- ▼ M6b: answers to the req's screening questions. DELETED for the same reason as the employment
  -- rows — they are the person's own words. An emptied row recording "they answered something"
  -- preserves nothing, and promptSnapshot alone proves nothing either.
  DELETE FROM "ApplicationAnswer"
   WHERE "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);
  -- ▲ END M6b

  UPDATE "Application"
     SET "employmentSnapshot" = NULL, "educationSnapshot" = NULL, "updatedAt" = now()
   WHERE "candidateId" = p_candidate_id
     AND ("employmentSnapshot" IS NOT NULL OR "educationSnapshot" IS NOT NULL);

  -- ⚠️ "ApplicationConsent" IS DELIBERATELY UNTOUCHED. It holds a policy version, a timestamp and a
  -- link — no name, no email, no IP — so there is no personal data in it to erase, and it is the
  -- evidence that the processing we DID do was lawful. Deleting it would destroy the record and
  -- protect nobody.
  -- ▲ END M6
  -- ▲ END M16 change

  -- Free text that can name them. Ratings, stages, dates and EEO answers all survive — they are
  -- about the process, not the person.
  UPDATE "Application" SET "rejectionReason" = NULL, "updatedAt" = now()
   WHERE "candidateId" = p_candidate_id AND "rejectionReason" IS NOT NULL;

  UPDATE "ApplicationEvent" SET note = NULL
   WHERE note IS NOT NULL
     AND "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);

  UPDATE "Scorecard" SET notes = NULL, "updatedAt" = now()
   WHERE notes IS NOT NULL
     AND "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);

  UPDATE "ScorecardRating" SET comment = NULL
   WHERE comment IS NOT NULL
     AND "scorecardId" IN (
       SELECT s.id FROM "Scorecard" s
       WHERE s."applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id)
     );

  -- The offer prose (M14). Same rule, same reason as Scorecard.notes above; the figures stay.
  UPDATE "Offer" SET notes = NULL, "outOfBandReason" = NULL, "updatedAt" = now()
   WHERE (notes IS NOT NULL OR "outOfBandReason" IS NOT NULL)
     AND "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);

  -- Close any open request this satisfies. HR may also erase without a request having been filed.
  UPDATE "ErasureRequest"
     SET status         = 'COMPLETED',
         "resolvedAt"   = now(),
         "resolvedById" = v_actor,
         "decisionNote" = COALESCE("decisionNote", NULLIF(btrim(COALESCE(p_note, '')), ''))
   WHERE "candidateId" = p_candidate_id AND status = 'PENDING';

  RETURN QUERY SELECT 'OK'::text, v_resume_key;
END;
$$;
