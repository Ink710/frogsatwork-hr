-- CreateEnum
CREATE TYPE "ErasureRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REFUSED');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "anonymisationNote" TEXT,
ADD COLUMN     "anonymisedAt" TIMESTAMP(3),
ADD COLUMN     "anonymisedById" TEXT;

-- CreateTable
CREATE TABLE "ErasureRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "ErasureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decisionNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT,
    "resolvedById" TEXT,

    CONSTRAINT "ErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureRequest_orgId_status_idx" ON "ErasureRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "Candidate_orgId_anonymisedAt_idx" ON "Candidate"("orgId", "anonymisedAt");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_anonymisedById_fkey" FOREIGN KEY ("anonymisedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- GDPR ERASURE (M10) — the deliberate inverse of employee-records' "never hard-delete" rule.
--
-- Employee records are retained because employment creates a retention duty. An APPLICANT creates
-- no such duty, so the right to erasure wins: their personal data is genuinely destroyed. What
-- survives is a SHELL — the candidate row with its identity stripped — so that every historical
-- count on /reports still balances. Destroy the person, keep the statistics.
--
-- Two SECURITY DEFINER doorways, for two very different callers:
--   app_request_erasure  — anonymous. Records a REQUEST. Never erases anything.
--   app_erase_candidate  — HR_ADMIN. Performs the erasure, and refuses when it must.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- Who may action erasure requests. HR_ADMIN only: erasure is irreversible and destroys evidence a
-- recruiter may still be relying on, so it sits with the role that owns compliance, not the role
-- that owns the pipeline.
CREATE OR REPLACE FUNCTION app_can_manage_erasure()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_setting('app.current_role', true) = 'HR_ADMIN'
     AND COALESCE(current_setting('app.current_org_id', true), '') <> '';
$$;

-- ErasureRequest — the compliance queue.
--   No INSERT policy: requests arrive only through app_request_erasure (an anonymous caller has no
--     session vars, and a signed-in one has no business forging a request in someone else's name).
--   No DELETE policy: a request that was made is a fact. Making it disappear is precisely the
--     behaviour the right to erasure exists to guard against, so the only exits are COMPLETED and
--     REFUSED — both of which record who decided and why.
ALTER TABLE "ErasureRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY erasure_request_read ON "ErasureRequest" FOR SELECT
  USING ("orgId" = current_setting('app.current_org_id', true) AND app_can_manage_erasure());
CREATE POLICY erasure_request_update ON "ErasureRequest" FOR UPDATE
  USING ("orgId" = current_setting('app.current_org_id', true) AND app_can_manage_erasure())
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true) AND app_can_manage_erasure());
REVOKE INSERT, DELETE ON "ErasureRequest" FROM hris_app;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- app_request_erasure — the public "please erase my data" endpoint.
--
-- The hard part is not recording the request; it is recording it WITHOUT becoming an oracle. Anyone
-- can type any address, so this function must behave identically whether or not we hold data for
-- it. Three properties make that true:
--
--   1. It ALWAYS returns 'OK'. There is no other return value. The caller — and therefore the page,
--      and therefore an attacker — cannot distinguish "recorded" from "we hold nothing". Same
--      reasoning as the bare DUPLICATE sentinel in app_submit_application.
--   2. The org is DERIVED from whatever candidate the email matches, never passed in. An anonymous
--      visitor has no org to supply and no way to aim at someone else's tenant.
--   3. No match means NOTHING is written. We don't accumulate rows about people we have no data on
--      — collecting data in response to an erasure request would be its own small absurdity.
--
-- It records one request PER MATCHING CANDIDATE, because in a multi-tenant deployment the same
-- person may sit in several organisations' talent pools, and each of them owes them an answer.
-- Already-anonymised candidates are skipped: there is nothing left to erase.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_request_erasure(p_email text, p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_row   record;
BEGIN
  IF v_email = '' THEN
    RETURN 'OK';
  END IF;

  FOR v_row IN
    SELECT c.id, c."orgId"
    FROM "Candidate" c
    WHERE lower(c.email) = v_email
      AND c."anonymisedAt" IS NULL
  LOOP
    -- Don't stack duplicates: a second request while one is still open is the same request.
    IF NOT EXISTS (
      SELECT 1 FROM "ErasureRequest" r
      WHERE r."candidateId" = v_row.id AND r.status = 'PENDING'
    ) THEN
      INSERT INTO "ErasureRequest" (id, email, status, reason, "requestedAt", "orgId", "candidateId")
      VALUES (gen_random_uuid()::text, v_email, 'PENDING', NULLIF(btrim(COALESCE(p_reason, '')), ''),
              now(), v_row."orgId", v_row.id);
    END IF;
  END LOOP;

  RETURN 'OK';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- app_erase_candidate — the erasure itself.
--
-- Returns (result, resume_key):
--   OK             — erased. resume_key is the object-storage key the CALLER must now delete, because
--                    SQL cannot remove a blob. Handing it back is the only way the two halves of the
--                    erasure can stay in step.
--   FORBIDDEN      — not HR_ADMIN.
--   NOT_FOUND      — no such candidate in the caller's organisation.
--   ALREADY_ERASED — idempotent; a retry is not an error.
--   HIRED          — refused, and this is the interesting one. See below.
--
-- ⚠️ WHY "HIRED" IS A REFUSAL. Once a candidate has become an employee, their data is governed by
-- the employment relationship, and employment records carry statutory retention obligations that
-- outrank the erasure right. This is the exact seam where the ATS's "destroy" rule meets
-- employee-records' "never hard-delete" rule, and the app has to be able to explain the boundary
-- rather than silently pick a side.
--
-- ⚠️ WHAT THIS FUNCTION CAN DO THAT NOTHING ELSE CAN. It blanks notes on "ApplicationEvent", a table
-- whose UPDATE privilege is REVOKED from hris_app precisely so hiring history can never be
-- rewritten. Being SECURITY DEFINER, it runs as the owner and steps around that revoke — so note
-- carefully what it touches: `note` and `rejectionReason` only. Never a stage, never a timestamp,
-- never an actor. The trail of WHAT HAPPENED stays intact; only the words that could name a person
-- are removed. That distinction is the whole justification for allowing this one exception.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
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

  -- Identity destroyed. `source` is KEPT: it describes a channel, not a person, and every
  -- source-effectiveness figure on /reports depends on it.
  --
  -- The replacement email satisfies the @@unique([orgId, email]) constraint and is a random UUID at
  -- the RFC-2606 reserved .invalid TLD, so it can never collide and can never be delivered to.
  --
  -- ⚠️ We deliberately do NOT store a hash of the original address. A salted hash of an email is
  -- still personal data under GDPR — it is pseudonymisation, not anonymisation — and keeping one
  -- would let us re-identify the person we just promised not to. The honest consequence is that an
  -- erased person can apply again later as a complete stranger. That is what erasure means.
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

GRANT EXECUTE ON FUNCTION app_can_manage_erasure() TO hris_app;
GRANT EXECUTE ON FUNCTION app_request_erasure(text, text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_erase_candidate(text, text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Candidate visibility policy — SHORT-CIRCUITED (performance, no behaviour change).
--
-- The original policy was `USING (app_can_see_candidate(id))`. That helper is SECURITY DEFINER and
-- Postgres calls it once per row SCANNED — and for a viewer who is not in a recruiting role it runs
-- a nested EXISTS over their applications. Erasure only ever ADDS rows to this table (shells are
-- never deleted), so the per-row cost is now something this milestone is directly responsible for.
--
-- The rewrite hoists the two cheap checks the helper was already making internally — same org, and
-- "is this a recruiting role?" — into the policy itself. For HR and recruiters the OR short-circuits
-- on a session-variable comparison and the function is never called at all; for everyone else
-- behaviour is byte-for-byte what it was. The existing RLS tests (recruiter sees all / manager sees
-- via their req / outsider sees none) are the proof, which is why they are not being changed.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS candidate_visibility ON "Candidate";
CREATE POLICY candidate_visibility ON "Candidate" FOR ALL
  USING (
    "orgId" = current_setting('app.current_org_id', true)
    AND (
      current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
      OR app_can_see_candidate(id)
    )
  )
  WITH CHECK (
    "orgId" = current_setting('app.current_org_id', true)
    AND (
      current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
      OR app_can_see_candidate(id)
    )
  );
