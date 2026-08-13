-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'EXTENDED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "SalaryBand" (
    "id" TEXT NOT NULL,
    "salaryMin" DECIMAL(12,2) NOT NULL,
    "salaryMax" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payBasis" "PayBasis" NOT NULL DEFAULT 'PER_YEAR',
    "postPublicly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "SalaryBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "salary" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payBasis" "PayBasis" NOT NULL DEFAULT 'PER_YEAR',
    "startDate" TIMESTAMP(3),
    "notes" TEXT,
    "outOfBandReason" TEXT,
    "bandMinSnapshot" DECIMAL(12,2),
    "bandMaxSnapshot" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryBand_jobId_key" ON "SalaryBand"("jobId");

-- CreateIndex
CREATE INDEX "Offer_jobId_idx" ON "Offer"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_version_key" ON "Offer"("applicationId", "version");

-- AddForeignKey
ALTER TABLE "SalaryBand" ADD CONSTRAINT "SalaryBand_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M14 — RLS for the compensation tables.
--
-- THE WHOLE POINT OF THIS MILESTONE IS THIS BLOCK. Every other ATS table is readable by the entire
-- hiring team (app_can_see_job) and writable only by its managers (app_can_manage_job). These two
-- are the first tables where READING is restricted to managers as well, because their contents are
-- compensation — and an INTERVIEWER seeing the band would anchor every score they write, quite apart
-- from it being none of their business.
--
-- No new SECURITY DEFINER helper is introduced. app_can_manage_job already says exactly the right
-- thing (recruiting roles, or a JobMember who is HIRING_MANAGER / RECRUITER — interviewers
-- excluded), and reusing it keeps enforcement and the UI's `canManage` flag on ONE definition, so
-- the button and the policy can never drift apart.
--
-- ⚠️ NOTE WHO THIS ALSO EXCLUDES: HR_GENERALIST. Bianca can SEE every requisition (app_can_see_job
-- lists her) but cannot MANAGE one, so she cannot read a band or an offer — even though she is the
-- persona who creates the employee record at the end of the hire. That is not an oversight to be
-- patched by widening the policy; it is the M8 situation exactly, and it gets the M8 answer: one
-- narrow doorway, app_offer_for_hire, at the bottom of this file.
--
-- The M5 "INSERT … RETURNING" trap does NOT apply here. That failure happened because Job's policy
-- looked the NEW ROW up in its own table mid-insert. These policies look up the parent JOB, which
-- already exists, so a plain Prisma create() works. (Verified in psql, not assumed.)
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "SalaryBand" ENABLE ROW LEVEL SECURITY;
CREATE POLICY salary_band_access ON "SalaryBand" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_access ON "Offer" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

-- Offers are SUPERSEDED, never deleted — the negotiation history is the reason the table is
-- versioned at all, and a DELETE would quietly destroy the thing it exists to keep. Enforced at the
-- database rather than by convention, the same way ApplicationEvent and EeoExportLog are protected.
-- (A band may be edited in place; it is a current-state setting, and its bearing on any past offer
-- is preserved by that offer's own snapshot columns.)
REVOKE DELETE ON "Offer" FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Pay transparency — the public careers listing gains the range.
--
-- ⚠️ DROP then CREATE, not CREATE OR REPLACE: Postgres refuses to replace a function whose RETURN
-- type changes, and adding columns to a RETURNS TABLE is exactly that. The same trap M10 hit when
-- app_submit_application gained its EEO parameters. The GRANT is dropped with the function and has
-- to be reissued.
--
-- The range is returned ONLY when the band says postPublicly. A LEFT JOIN plus that condition means
-- an unposted band yields NULLs, so "not advertised" and "no band at all" look identical from
-- outside — the function must not become a way to ask whether a req has a band.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS app_public_jobs();
CREATE FUNCTION app_public_jobs()
RETURNS TABLE (
  id text,
  title text,
  description text,
  location text,
  "employmentType" "EmploymentType",
  "publishedAt" timestamp(3),
  "salaryMin" numeric,
  "salaryMax" numeric,
  currency text,
  "payBasis" "PayBasis"
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.title, j.description, j.location, j."employmentType", j."publishedAt",
         CASE WHEN b."postPublicly" THEN b."salaryMin" END,
         CASE WHEN b."postPublicly" THEN b."salaryMax" END,
         CASE WHEN b."postPublicly" THEN b.currency END,
         CASE WHEN b."postPublicly" THEN b."payBasis" END
  FROM "Job" j
  LEFT JOIN "SalaryBand" b ON b."jobId" = j.id
  WHERE j.status = 'OPEN' AND j."publishedAt" IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION app_public_jobs() TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ NO DOORWAY FUNCTION HERE, AND THE ABSENCE IS DELIBERATE — read this before adding one.
--
-- M8's hire seam needed `app_link_hire` because NEITHER role spanned it: an HR_GENERALIST could
-- create the employee but not write the Application, and a recruiter was the reverse. The obvious
-- move is to reason by analogy and give the salary prefill its own passage too. That analogy DOES
-- NOT HOLD, because the compensation gate NARROWS the population instead of splitting it:
--
--     canEditEmployee      = HR_ADMIN, HR_GENERALIST      (may create the employee)
--     canEditCompensation  = HR_ADMIN, PAYROLL_ADMIN      (may set a salary)
--     app_can_manage_job   = HR_ADMIN, RECRUITER, SYSTEM  (may read an Offer)
--
-- The intersection of the first two — the people who can actually USE an offer figure when creating
-- an employee — is HR_ADMIN alone, and HR_ADMIN is already inside app_can_manage_job. So a plain
-- RLS-scoped read serves exactly the right population and returns nothing to everyone else, with no
-- bypass to audit. An HR_GENERALIST gets null, which is correct rather than unfortunate: she cannot
-- set compensation at all, so a prefilled salary would be a figure she is not permitted to submit.
--
-- (Verified in psql, not reasoned about: as HR_ADMIN, `SELECT count(*) FROM "Offer"` returns the
-- row and app_can_manage_job('job-be') is true.)
--
-- Every SECURITY DEFINER function is a permanent hole with a permanent justification burden. This
-- one had no justification, so it does not exist. If a future role can create employees AND set
-- comp WITHOUT hiring-team access, that is the moment to add it.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED to blank the offer free text (M14).
--
-- The function is reproduced in full because a plpgsql body cannot be patched in place. The ONLY
-- change is the two new UPDATE statements on "Offer", marked below.
--
-- ⚠️ WHY THE OFFER PROSE IS ON THIS LIST AND THE FIGURES ARE NOT. `notes` and `outOfBandReason` are
-- where a person's identity survives an erasure — "she has a competing offer from Acme", "matching
-- his current employer" — exactly like Scorecard.notes. The salary, currency and dates describe what
-- the COMPANY decided about a ROLE; they are process data, and they stay, for the same reason the
-- ratings, stages and EEO answers stay: /reports must balance after an erasure, and it does.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_erase_candidate(p_candidate_id text, p_note text DEFAULT NULL)
RETURNS TABLE (result text, resume_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
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

  UPDATE "Candidate"
     SET "firstName"         = 'Erased',
         "lastName"          = 'candidate',
         email               = 'erased+' || gen_random_uuid()::text || '@anonymised.invalid',
         phone               = NULL,
         "resumeKey"         = NULL,
         "resumeFileName"    = NULL,
         "anonymisedAt"      = now(),
         "anonymisedById"    = v_actor,
         "anonymisationNote" = NULLIF(btrim(COALESCE(p_note, '')), ''),
         "updatedAt"         = now()
   WHERE id = p_candidate_id;

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

  -- ▼ NEW IN M14 — the offer prose. Same rule, same reason as Scorecard.notes above.
  UPDATE "Offer" SET notes = NULL, "outOfBandReason" = NULL, "updatedAt" = now()
   WHERE (notes IS NOT NULL OR "outOfBandReason" IS NOT NULL)
     AND "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);
  -- ▲ END M14 addition

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
