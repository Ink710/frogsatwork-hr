-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('CAREERS_PAGE', 'COMPANY_WEBSITE', 'REFERRAL', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'JOB_BOARD', 'OTHER');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "channel" "SourceChannel" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_orgId_slug_key" ON "Campaign"("orgId", "slug");
CREATE INDEX "Campaign_orgId_archivedAt_idx" ON "Campaign"("orgId", "archivedAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "campaignId" TEXT;

-- CreateIndex
CREATE INDEX "Application_orgId_campaignId_idx" ON "Application"("orgId", "campaignId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M2 — THE ATTRIBUTION REGISTRY.
--
-- WHAT M1 LEFT OPEN. M1 moved attribution onto "Application".source, but that column was still free
-- text handed in by an ANONYMOUS caller: app_submit_application takes `p_source text` straight off
-- the public apply path. Anyone could post ?source=<anything> — ten thousand applications tagged
-- with a competitor's name, or a "source" that is really a person's name sitting inside a report
-- that deliberately survives erasure. This migration closes that.
--
-- TWO VOCABULARIES, ON PURPOSE:
--   * "SourceChannel" (enum)  — the fixed axis /reports rolls up on. A roll-up is only meaningful
--     over a vocabulary that cannot drift, so adding a channel is a migration. That is the feature.
--   * "Campaign" (table)      — named campaigns with a URL slug, created by recruiters with no
--     deploy. This is what a tracking link points at.
-- Campaigns alone would make "LinkedIn — March grads" and "LinkedIn — senior push" two unrelated
-- rows and destroy the "how is LinkedIn doing overall" question. The channel is what preserves it.
--
-- "Application" KEEPS `source` as a SNAPSHOT of the campaign's name alongside the new FK. Same
-- reasoning as ApplicationEvent.roundName: a campaign can be renamed or retired years later, and
-- history must not silently change to match. FK = "which campaign is this, now"; snapshot = "what
-- we called it when they applied".
--
-- NO EXPLICIT GRANT: ALTER DEFAULT PRIVILEGES (20260701050339_audit_append_only) already grants new
-- tables to hris_app.
--
-- ⚠️ "Campaign" IS DELIBERATELY FREE OF PERSONAL DATA — that is what lets attribution outlive an
-- erasure, and it is why app_erase_candidate needs no change here. `name` is a channel label, never
-- a person. A campaign named after the individual who made a referral would push a name into
-- figures that survive erasure, which is the same hazard leadNote carries a warning about.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — read is org-wide, write is a recruiting role.
--
-- Asymmetric on purpose. A channel label is not sensitive and the pipeline board, the candidate
-- filter and /reports all need to resolve one, so narrowing READ would break those for a hiring
-- manager while protecting nothing. WRITING is the recruiting decision — same role list as
-- canCreateJob and the leads pool.
--
-- Note this table needs NO SECURITY DEFINER helper: visibility is a plain orgId comparison, not a
-- per-row question, so the policy costs a session-variable compare rather than a function call per
-- row scanned (the cost the candidate_erasure migration exists to avoid).
--
-- Note also what this does NOT need: the raw-INSERT workaround createJob uses. That exists because
-- job_read cannot see a brand-new row mid-insert, so `INSERT … RETURNING` trips the SELECT policy.
-- campaign_read is a bare orgId match, which a new row satisfies immediately — so ordinary Prisma
-- create() works here.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_read ON "Campaign" FOR SELECT
  USING ("orgId" = current_setting('app.current_org_id', true));

CREATE POLICY campaign_write ON "Campaign" FOR ALL
  USING (
    "orgId" = current_setting('app.current_org_id', true)
    AND current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
  )
  WITH CHECK (
    "orgId" = current_setting('app.current_org_id', true)
    AND current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
  );

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL — turn M1's distinct free-text sources into real campaigns, per org.
--
-- Known labels map to their channel; anything else lands in OTHER rather than being guessed into a
-- plausible-looking one. Applications left NULL by M1 (the repeat applicants whose attribution was
-- genuinely unknowable) stay NULL — this migration does not invent what the last one refused to.
--
-- `createdById` prefers the SYSTEM user and falls back to the org's oldest user, because these rows
-- were not opened by a person. On a FRESH database (CI, a new Neon project) migrations run BEFORE
-- the seed, so "Application" is empty, this SELECT yields no rows, and the FK is never exercised.
--
-- ON CONFLICT DO NOTHING guards the one collision this can produce: two different labels that
-- slugify to the same string. The second simply doesn't get a campaign, and its applications stay
-- unattributed — visible as "Unknown" rather than silently merged into the wrong campaign.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO "Campaign" (id, name, slug, channel, "createdAt", "updatedAt", "orgId", "createdById")
SELECT
  gen_random_uuid()::text,
  s.source,
  btrim(regexp_replace(lower(btrim(s.source)), '[^a-z0-9]+', '-', 'g'), '-'),
  (CASE lower(btrim(s.source))
     WHEN 'careers page'    THEN 'CAREERS_PAGE'
     WHEN 'company website' THEN 'COMPANY_WEBSITE'
     WHEN 'referral'        THEN 'REFERRAL'
     WHEN 'linkedin'        THEN 'LINKEDIN'
     WHEN 'facebook'        THEN 'FACEBOOK'
     WHEN 'instagram'       THEN 'INSTAGRAM'
     WHEN 'job board'       THEN 'JOB_BOARD'
     ELSE 'OTHER'
   END)::"SourceChannel",
  now(), now(), s."orgId",
  COALESCE(
    (SELECT u.id FROM "User" u WHERE u.id = '00000000-0000-0000-0000-000000000001'),
    (SELECT u.id FROM "User" u WHERE u."orgId" = s."orgId" ORDER BY u."createdAt" LIMIT 1)
  )
FROM (SELECT DISTINCT "orgId", source FROM "Application" WHERE source IS NOT NULL) s
ON CONFLICT ("orgId", slug) DO NOTHING;

UPDATE "Application" a
   SET "campaignId" = c.id
  FROM "Campaign" c
 WHERE c."orgId" = a."orgId" AND c.name = a.source;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — REPLACED so the public path can only record a KNOWN campaign (M2).
--
-- Reproduced in full because a plpgsql body cannot be patched in place. Changes from the M1 version
-- are the new step (0) and the two INSERTs that consume its results.
--
-- SIGNATURE UNCHANGED — same twelve parameters — so CREATE OR REPLACE suffices and the existing
-- GRANT still applies. What changed is the MEANING of p_source: it is now a campaign SLUG (the
-- ?source= value from a tracking link), not a display label.
--
-- ⚠️ UNRECOGNISED INPUT IS DISCARDED, NOT RECORDED. An unknown slug, or one belonging to an ARCHIVED
-- campaign, yields NULL attribution and the application is still accepted. Two decisions in that:
--
--   * Storing the raw string on a miss would preserve exactly the attacker-controlled free text this
--     milestone exists to delete. "Unknown" is the honest answer and it cannot be poisoned.
--   * REFUSING the application on a bad slug would let a mangled marketing link cost someone a job.
--     Attribution is our bookkeeping problem; it must never become the applicant's problem.
--
-- This function is the boundary, not the Zod schema in @hris/recruiting — that is defence in depth
-- in front of it, exactly like the honeypot and the rate limit on the careers action.
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
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(),
          v_source_label, v_campaign_id,
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
