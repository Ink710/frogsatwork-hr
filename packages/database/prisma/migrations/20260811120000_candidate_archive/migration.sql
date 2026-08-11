-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- CANDIDATE ARCHIVE + SEARCH INDEX (M11)
--
-- The other half of M10's erasure/archive split. Erasure DESTROYS (no restore, no exceptions);
-- archiving MOVES A RECORD OUT OF THE WAY and is fully reversible. They are different obligations
-- and they get different mechanisms — but note what this migration does NOT add: no new table, no
-- new RLS policy, no new SECURITY DEFINER function.
--
-- ⚠️ WHY THIS IS A COLUMN AND NOT A COLD-STORAGE TABLE. "Move the row somewhere else" breaks on
-- referential integrity: "Application"."candidateId" is a REQUIRED foreign key, so relocating a
-- candidate means relocating Application → ApplicationEvent → Scorecard → ScorecardRating →
-- EeoResponse along with it, or dropping the constraint. A nullable timestamp buys the same thing
-- for none of that risk. It also makes a subtler problem disappear: because an archived candidate
-- is STILL THE SAME ROW, app_erase_candidate already covers them. "The archive is a second place
-- personal data hides" is not mitigated here — it is structurally impossible.
--
-- (If the hot table ever genuinely needs to be physically smaller, the tool is Postgres table
-- partitioning, not a hand-rolled second table. Nowhere near that scale.)
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- Trigram matching, required by the search index below. Created before the index that needs it.
-- Deliberately NOT declared via Prisma's `postgresqlExtensions` preview feature: leaving it out of
-- the schema means `migrate diff` ignores extensions entirely, so this can never show up as drift.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT;

-- CreateIndex
CREATE INDEX "Candidate_orgId_archivedAt_idx" ON "Candidate"("orgId", "archivedAt");

-- CreateIndex
--
-- The candidate search matches with Prisma's `contains` + mode:"insensitive", which becomes
-- ILIKE '%token%'. A leading wildcard makes a B-tree useless — no prefix to seek on — so that
-- search has been a guaranteed sequential scan since M4. GIN + gin_trgm_ops is the index type that
-- can actually serve it, by indexing every 3-character substring.
--
-- ⚠️ Proving this works needs care: on a small table the planner will sequential-scan anyway
-- because it is genuinely cheaper. Verify with `SET enable_seqscan = off;` + EXPLAIN ANALYZE and
-- look for a Bitmap Index Scan — "the query still returns the right rows" proves nothing.
CREATE INDEX "Candidate_firstName_lastName_email_idx" ON "Candidate" USING GIN ("firstName" gin_trgm_ops, "lastName" gin_trgm_ops, "email" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Retention policy setting ─────────────────────────────────────────────────────────────────
-- How many days of inactivity before the sweep archives a candidate. Lives in AppSetting so HR can
-- change it without a deploy, exactly like the storage folder.
--
-- ⚠️ AppSetting is a GLOBAL key/value table — no orgId, no RLS — so this is a deployment-wide
-- policy rather than a per-tenant one. Consistent with how storage is already configured; noted
-- here so it is a known limitation rather than a later surprise.
INSERT INTO "AppSetting" (key, value, "updatedAt")
VALUES ('candidateRetentionDays', '365', now())
ON CONFLICT (key) DO NOTHING;
