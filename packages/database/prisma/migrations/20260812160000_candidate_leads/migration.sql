-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "leadMarkedAt" TIMESTAMP(3),
ADD COLUMN     "leadMarkedById" TEXT,
ADD COLUMN     "leadNote" TEXT;

-- CreateIndex
CREATE INDEX "Candidate_orgId_leadMarkedAt_idx" ON "Candidate"("orgId", "leadMarkedAt");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_leadMarkedById_fkey" FOREIGN KEY ("leadMarkedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M16 — the great-leads pool.
--
-- NO NEW RLS AND NO NEW FUNCTION, and both absences are decisions rather than omissions:
--
--   * The columns live on "Candidate", which is already governed by `candidate_visibility`. A
--     hiring manager can therefore only touch candidates who applied to a req they can see — the
--     row-level rule the pool needs is already in force.
--   * The remaining gate ("you must MANAGE one of their reqs", which excludes interviewers) is
--     enforced in the app layer, by asking the existing app_can_manage_job about each application.
--     That is the same deliberate asymmetry M11 documented for archive/restore: the strength of a
--     guard should match the cost of getting it wrong, and marking a lead is undone by pressing the
--     other button. Erasure is gated in the database because it is not.
--
-- ⚠️ AND NOTE WHAT IS DELIBERATELY *NOT* HERE: nothing exempts a lead from the retention sweep.
-- `isEligibleForArchive` does not look at these columns on purpose. Keeping someone in the ACTIVE
-- pool indefinitely because we once liked them is exactly the open-ended retention the policy exists
-- to bound; the /candidates/leads pool is what keeps them findable, and it lists archived leads on
-- purpose. Without that last detail the sweep would silently empty this feature about a year in.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED so an erasure also destroys the lead mark (M16).
--
-- Reproduced in full because a plpgsql body cannot be patched in place. The ONLY change from the
-- M14 version is the marked block near the end.
--
-- ⚠️ WHY THE MARK ITSELF GOES, not just the note. Everywhere else this function is careful to keep
-- process data and destroy only identity — ratings, stages and EEO answers all survive. The lead
-- mark is the exception that proves the rule, because it is not a fact about the PROCESS at all: it
-- is a standing instruction to CONTACT THIS PERSON AGAIN. Once the name, email and phone are gone
-- there is nobody to contact, so leaving the flag set would put an empty shell in a recruiter's
-- "call these people" list forever. The note goes for the ordinary reason — it is free text that can
-- name someone, exactly like Scorecard.notes and Offer.notes.
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
