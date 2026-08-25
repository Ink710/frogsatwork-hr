-- CreateTable
CREATE TABLE "CandidateEmployment" (
    "id" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "summary" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "candidateId" TEXT NOT NULL,

    CONSTRAINT "CandidateEmployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateEducation" (
    "id" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "candidateId" TEXT NOT NULL,

    CONSTRAINT "CandidateEducation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationConsent" (
    "id" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "ApplicationConsent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "employmentSnapshot" JSONB,
ADD COLUMN "educationSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "CandidateEmployment_candidateId_position_idx" ON "CandidateEmployment"("candidateId", "position");
CREATE INDEX "CandidateEducation_candidateId_position_idx" ON "CandidateEducation"("candidateId", "position");
CREATE UNIQUE INDEX "ApplicationConsent_applicationId_key" ON "ApplicationConsent"("applicationId");
CREATE INDEX "ApplicationConsent_jobId_idx" ON "ApplicationConsent"("jobId");

-- AddForeignKey
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationConsent" ADD CONSTRAINT "ApplicationConsent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationConsent" ADD CONSTRAINT "ApplicationConsent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M6 — WHAT AN APPLICATION ACTUALLY CARRIES: profile, history, consent.
--
-- THE PAIRING IS THE DESIGN. An applicant maintains ONE profile (CandidateEmployment /
-- CandidateEducation) so a second application is quick; each application keeps a FROZEN COPY of what
-- was submitted (Application.employmentSnapshot / educationSnapshot). Editing your profile therefore
-- cannot rewrite what a recruiter is already reading — the same rule Application.source and
-- ApplicationEvent.roundName already follow.
--
-- The snapshots are JSONB rather than two more child tables because they are display-only: nothing
-- joins or filters them, so a relational copy would buy nothing and add two more tables to the
-- erasure registry, where every extra table is another chance to forget one. Querying PEOPLE by
-- employer stays possible through the profile tables.
--
-- RLS: the two profile tables delegate to app_can_see_candidate(candidateId), exactly as
-- EmployeeHistory / EmployeeDocument delegate to app_can_see_employee. ApplicationConsent is gated
-- by app_can_see_job(jobId) like EeoResponse — same denormalized-owner-column trick, so the policy
-- stays a one-liner and never joins an RLS-protected table from inside a policy.
--
-- NO EXPLICIT GRANT: ALTER DEFAULT PRIVILEGES (audit_append_only) already covers new tables.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "CandidateEmployment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_employment_visibility ON "CandidateEmployment" FOR ALL
  USING (app_can_see_candidate("candidateId"))
  WITH CHECK (app_can_see_candidate("candidateId"));

ALTER TABLE "CandidateEducation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_education_visibility ON "CandidateEducation" FOR ALL
  USING (app_can_see_candidate("candidateId"))
  WITH CHECK (app_can_see_candidate("candidateId"));

-- Consent is READ-ONLY to the app role once written. It is evidence, and evidence that the
-- application can edit is not evidence — the same append-only reasoning as the audit log and
-- ApplicationEvent. It is written ONLY through app_submit_application (SECURITY DEFINER).
ALTER TABLE "ApplicationConsent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_consent_read ON "ApplicationConsent" FOR SELECT
  USING (app_can_see_job("jobId"));
REVOKE UPDATE, DELETE ON "ApplicationConsent" FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — DROPPED and RECREATED with three new parameters (M6).
--
-- ⚠️ WHY DROP RATHER THAN CREATE OR REPLACE. Adding parameters changes the SIGNATURE, so
-- CREATE OR REPLACE would not replace anything — it would create a SECOND function beside the old
-- twelve-argument one. Postgres would then find the existing 12-argument call ambiguous (it matches
-- the old function exactly, and the new one via defaults) and refuse it outright. The old signature
-- has to go first.
--
-- The three additions all DEFAULT NULL, so the ATS careers page — kept as the anonymous fallback
-- per decision D — keeps calling with twelve arguments and behaves exactly as before: no profile
-- rows, no snapshots, no consent record.
--
-- Everything stays in ONE function because it must be ATOMIC. Candidate, application, event, EEO,
-- profile, snapshots and consent either all land or none do; a follow-up write from the app layer
-- would leave half-applications behind whenever the second call failed.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS app_submit_application(text, text, text, text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION app_submit_application(p_job_id text, p_first_name text, p_last_name text, p_email text, p_phone text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_resume_key text DEFAULT NULL::text, p_resume_name text DEFAULT NULL::text, p_eeo_gender text DEFAULT NULL::text, p_eeo_ethnicity text DEFAULT NULL::text, p_eeo_veteran text DEFAULT NULL::text, p_eeo_disability text DEFAULT NULL::text,
  p_employment jsonb DEFAULT NULL,
  p_education jsonb DEFAULT NULL,
  p_consent_version text DEFAULT NULL)
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

  RETURN QUERY SELECT 'OK'::text, v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_submit_application(
  text, text, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED so an erasure also destroys the profile and the snapshots (M6).
-- Reproduced from the LIVE definition (pg_get_functiondef) rather than retyped; the only change is
-- the marked M6 block. See the erasure-registry rule: every new table holding applicant PII is
-- handled here IN THE SAME MIGRATION that creates it.
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
