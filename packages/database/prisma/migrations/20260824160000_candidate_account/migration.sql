-- CreateTable
CREATE TABLE "CandidateAccount" (
    "id" TEXT NOT NULL,
    "loginTokenHash" TEXT,
    "loginTokenExpires" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,

    CONSTRAINT "CandidateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAccount_loginTokenHash_key" ON "CandidateAccount"("loginTokenHash");
CREATE UNIQUE INDEX "CandidateAccount_candidateId_key" ON "CandidateAccount"("candidateId");

-- AddForeignKey
ALTER TABLE "CandidateAccount" ADD CONSTRAINT "CandidateAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateAccount" ADD CONSTRAINT "CandidateAccount_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M4 — THE SUITE'S FIRST NON-EMPLOYEE IDENTITY.
--
-- WHY A SEPARATE TABLE rather than an APPLICANT value on "Role". Every staff gate in this system is
-- an ALLOW-list, so a new enum value would fail closed — but that is a property of code, which can
-- change. A separate table makes "an applicant cannot hold a staff session" true by construction.
-- It also sidesteps a real collision: "User".email is globally unique while "Candidate".email is
-- unique PER ORG, so an employee applying to an internal req would clash.
--
-- ⚠️ NO EMAIL COLUMN AND NO PASSWORD HASH. The login address is "Candidate".email — one source of
-- truth — and login is a one-time emailed link. What remains holds NO personal data: an id, a token
-- hash, timestamps. That is what makes it safe for this table to live OUTSIDE RLS, exactly as "User"
-- does, and it MUST live outside RLS because the auth flow reads it before any session exists (a
-- policy keyed on session variables could never match).
--
-- NO EXPLICIT GRANT: ALTER DEFAULT PRIVILEGES (audit_append_only) already grants new tables to
-- hris_app.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_issue_candidate_login — mint a one-time login link, or say nothing happened.
--
-- ⚠️ WHY A SECURITY DEFINER FUNCTION AT ALL. "Candidate" is under RLS, and this runs with NO session
-- (the caller is a stranger typing an email into a public form), so a bare SELECT would match zero
-- rows and every login would silently fail. This is the same doorway shape as app_request_erasure.
--
-- ⚠️ THE CALLER MUST ANSWER THE USER IDENTICALLY FOR 'OK' AND 'NONE'. The return value exists only
-- so the server knows whether to send an email. Telling someone "no account with that address" would
-- turn this endpoint into a way to ask "is this person in your hiring database?" — precisely the
-- question the erasure page was built never to answer.
--
-- Refuses three states, each for its own reason:
--   • no candidate            → nothing to log in to.
--   • ERASED candidate        → the identity is gone; their email is already a scrambled placeholder,
--                               so this is belt-and-braces rather than the only guard.
--   • CLOSED account (hired)  → they are staff now; the portal is no longer their door.
--
-- Deliberately NOT refused: an ARCHIVED candidate. Archiving is a retention housekeeping state about
-- OUR hot path, not a judgement about the person — someone who applied 18 months ago is still
-- entitled to see what happened to their application.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_issue_candidate_login(
  p_email      text,
  p_token_hash text,
  p_expires    timestamp(3)
)
RETURNS TABLE (result text, candidate_id text, first_name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email     text := lower(btrim(p_email));
  v_candidate record;
  v_closed    timestamp(3);
BEGIN
  SELECT c.id, c."firstName", c."orgId"
    INTO v_candidate
  FROM "Candidate" c
  WHERE lower(c.email) = v_email
    AND c."anonymisedAt" IS NULL;

  IF v_candidate.id IS NULL THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT a."closedAt" INTO v_closed
  FROM "CandidateAccount" a WHERE a."candidateId" = v_candidate.id;

  IF v_closed IS NOT NULL THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Upsert: the account is created on FIRST login request, so an account only ever exists for
  -- someone who actually applied. Re-requesting a link OVERWRITES the previous hash, which
  -- invalidates the older link — a resend supersedes, exactly like the staff invite flow.
  INSERT INTO "CandidateAccount" (id, "loginTokenHash", "loginTokenExpires", "createdAt", "updatedAt",
                                  "orgId", "candidateId")
  VALUES (gen_random_uuid()::text, p_token_hash, p_expires, now(), now(),
          v_candidate."orgId", v_candidate.id)
  ON CONFLICT ("candidateId") DO UPDATE
    SET "loginTokenHash"    = EXCLUDED."loginTokenHash",
        "loginTokenExpires" = EXCLUDED."loginTokenExpires",
        "updatedAt"         = now();

  RETURN QUERY SELECT 'OK'::text, v_candidate.id, v_candidate."firstName";
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_redeem_candidate_login — spend a link, exactly once.
--
-- ⚠️ THE SINGLE-USE GUARANTEE IS THE ATOMICITY OF THIS ONE STATEMENT, not a check followed by a
-- write. A read-then-update would let two requests carrying the same link both pass the read and
-- both mint a session. Here the UPDATE's WHERE clause is the check, and Postgres serialises row
-- updates, so the second one matches nothing and returns no rows.
--
-- Clearing the hash in the same statement is what "one time" means; a redeemed link is not merely
-- marked used, it stops existing.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_redeem_candidate_login(p_token_hash text)
RETURNS TABLE (account_id text, candidate_id text, org_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE "CandidateAccount"
     SET "loginTokenHash"    = NULL,
         "loginTokenExpires" = NULL,
         "lastLoginAt"       = now(),
         "updatedAt"         = now()
   WHERE "loginTokenHash" = p_token_hash
     AND "loginTokenExpires" > now()
     AND "closedAt" IS NULL
  RETURNING id, "candidateId", "orgId";
$$;

-- Close an applicant's account. Separate from app_link_hire so the rule is testable on its own and
-- so a future path (a candidate asking to close their own account) has a door that already exists.
CREATE OR REPLACE FUNCTION app_close_candidate_account(p_candidate_id text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE "CandidateAccount"
     SET "closedAt"          = COALESCE("closedAt", now()),
         "loginTokenHash"    = NULL,
         "loginTokenExpires" = NULL,
         "updatedAt"         = now()
   WHERE "candidateId" = p_candidate_id;
$$;

GRANT EXECUTE ON FUNCTION app_issue_candidate_login(text, text, timestamp(3)) TO hris_app;
GRANT EXECUTE ON FUNCTION app_redeem_candidate_login(text)                    TO hris_app;
GRANT EXECUTE ON FUNCTION app_close_candidate_account(text)                   TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_link_hire — REPLACED so onboarding also CLOSES the applicant's portal account (M4).
--
-- Reproduced in full because a plpgsql body cannot be patched in place. The only change is the
-- marked block; the signature is unchanged, so the existing GRANT still applies.
--
-- WHY HERE rather than in the app layer: this function IS the hire seam. Closing the account in the
-- same statement that records the onboarding means the two can never disagree — there is no window
-- in which someone is an employee AND still holds a live applicant session, and no code path that
-- can hire somebody while forgetting this step.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_link_hire(p_application_id text, p_employee_id text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage        "ApplicationStage";
  v_job_id       text;
  v_existing     text;
  v_org_id       text;
  v_openings     integer;
  v_hires        integer;
  v_candidate_id text;
BEGIN
  -- Onboarding belongs to whoever owns employee records — NOT to recruiters.
  IF current_setting('app.current_role', true) NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT a.stage, a."jobId", a."hiredEmployeeId", a."orgId", a."candidateId"
    INTO v_stage, v_job_id, v_existing, v_org_id, v_candidate_id
  FROM "Application" a WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  -- Same-tenant check: the employee must belong to the application's org.
  IF NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id = p_employee_id AND e."orgId" = v_org_id) THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- Reaching HIRED is the DECISION; this function records the ONBOARDING. Never invent the former.
  IF v_stage <> 'HIRED' THEN RETURN 'NOT_HIRED'; END IF;
  IF v_existing IS NOT NULL THEN RETURN 'ALREADY_LINKED'; END IF;

  UPDATE "Application" SET "hiredEmployeeId" = p_employee_id, "updatedAt" = now()
  WHERE id = p_application_id;

  -- ▼ M4: they are staff now. Their record lives in employee-records, and the public-facing portal
  -- stops being a door into their interview and offer history. A no-op when they never made an
  -- account, which is the common case.
  PERFORM app_close_candidate_account(v_candidate_id);
  -- ▲ END M4 change

  -- Requisition lifecycle: fill the req once every opening has a hire behind it.
  SELECT j.openings INTO v_openings FROM "Job" j WHERE j.id = v_job_id;
  SELECT count(*) INTO v_hires FROM "Application" a
   WHERE a."jobId" = v_job_id AND a.stage = 'HIRED' AND a."hiredEmployeeId" IS NOT NULL;

  IF v_hires >= COALESCE(v_openings, 1) THEN
    UPDATE "Job" SET status = 'FILLED', "updatedAt" = now()
    WHERE id = v_job_id AND status = 'OPEN'; -- never resurrect a CLOSED/PAUSED req
  END IF;

  RETURN 'OK';
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED so an erasure also DESTROYS the portal account (M4).
--
-- Reproduced in full; the only change is the marked line. This is the erasure-registry rule the
-- roadmap set: every new table holding applicant identity must be handled here IN THE SAME MIGRATION
-- that creates it, or the compliance page reports a complete erasure that isn't one.
--
-- ⚠️ DELETED, not blanked. Everywhere else this function preserves the PROCESS and destroys only the
-- identity — stages, ratings, dates and EEO answers all survive, because they are facts about what
-- happened. An account records nothing about the process; it is purely a way for a person to come
-- back. With the person erased there is nobody to come back, so the row has no meaning to keep.
--
-- (Note the ON DELETE CASCADE on the FK would also remove it if the Candidate row were ever deleted
-- — but candidates are never hard-deleted here, so this explicit DELETE is the one that runs.)
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
$$
