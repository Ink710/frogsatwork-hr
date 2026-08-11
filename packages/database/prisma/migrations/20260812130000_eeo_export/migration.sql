-- CreateEnum
CREATE TYPE "EeoJobCategory" AS ENUM ('EXECUTIVE_SENIOR_OFFICIALS', 'FIRST_MID_OFFICIALS', 'PROFESSIONALS', 'TECHNICIANS', 'SALES_WORKERS', 'ADMINISTRATIVE_SUPPORT', 'CRAFT_WORKERS', 'OPERATIVES', 'LABORERS_HELPERS', 'SERVICE_WORKERS');

-- CreateEnum
CREATE TYPE "EeoExportVariant" AS ENUM ('SUMMARY', 'FILING');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "eeoJobCategory" "EeoJobCategory";

-- CreateTable
CREATE TABLE "EeoExportLog" (
    "id" TEXT NOT NULL,
    "variant" "EeoExportVariant" NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "uncategorisedJobs" INTEGER NOT NULL DEFAULT 0,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "EeoExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EeoExportLog_orgId_exportedAt_idx" ON "EeoExportLog"("orgId", "exportedAt");

-- AddForeignKey
ALTER TABLE "EeoExportLog" ADD CONSTRAINT "EeoExportLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EeoExportLog" ADD CONSTRAINT "EeoExportLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE EEO-1 EXPORT (M12) — and the reason it needs its own audit table.
--
-- M10 made EeoResponse unreadable and gave HR_ADMIN a suppressed aggregate. That was the right
-- shape for a SCREEN, but it cannot file an EEO-1: a regulatory return needs EXACT headcounts, and
-- the on-screen report deliberately withholds any group under five.
--
-- Rather than weaken the report, this milestone adds a SECOND artifact with a different audience:
--
--   SUMMARY  — the screen, as CSV. Suppressed. HR_ADMIN + HR_GENERALIST. For internal circulation.
--   FILING   — the EEO-1 cross-tab. EXACT. HR_ADMIN only. Audited on every single use.
--
-- Two audiences, two rules. The EEOC is entitled to exact counts; a hiring manager is not; and an
-- HR generalist sits in between. Collapsing that into one export would either produce a file that
-- cannot be filed, or quietly turn the export into a way to recover every number the report hides.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- WIDENED (was HR_ADMIN only, M10). The M10 decision was explicit that the narrow gate held only
-- "until there is a task that requires it" — the EEO-1 export IS that task, and filing is
-- generalist work in most organisations. Note this widens the SUPPRESSED report only; exact counts
-- get their own gate below, so the widening cannot leak a withheld figure.
CREATE OR REPLACE FUNCTION app_can_read_eeo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST')
     AND COALESCE(current_setting('app.current_org_id', true), '') <> '';
$$;

-- The narrow gate: who may obtain UNSUPPRESSED demographic counts. HR_ADMIN alone.
--
-- Kept as a separate function rather than a parameter on app_can_read_eeo, so that "may see the
-- report" and "may see exact numbers" can never be confused for each other at a call site — and so
-- the widening above could happen without touching this one at all.
CREATE OR REPLACE FUNCTION app_can_file_eeo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_setting('app.current_role', true) = 'HR_ADMIN'
     AND COALESCE(current_setting('app.current_org_id', true), '') <> '';
$$;

-- The EEO-1 cross-tab: headcount by job category × sex × race.
--
-- Returned in TIDY LONG form (one row per populated combination) rather than pre-pivoted, because
-- the pivot is a presentation concern and SQL is a poor place to do it. The CSV writer pivots.
--
-- Deliberately NOT an option on app_eeo_summary. That function returns per-dimension totals for a
-- screen and applies to a wider audience; this one returns exact cross-tabbed counts to one role.
-- Two purposes, two functions, neither compromised to serve the other.
--
-- Rows with no job category are returned with jobCategory NULL rather than being dropped or
-- bucketed: a filing that silently omits people is worse than one that shows a gap.
CREATE OR REPLACE FUNCTION app_eeo_filing()
RETURNS TABLE (job_category text, gender text, ethnicity text, headcount int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text := current_setting('app.current_org_id', true);
BEGIN
  IF NOT app_can_file_eeo() THEN
    RETURN; -- zero rows; the caller asks app_can_file_eeo() to learn why
  END IF;

  RETURN QUERY
    SELECT j."eeoJobCategory"::text, e.gender::text, e.ethnicity::text, count(*)::int
      FROM "EeoResponse" e
      JOIN "Job" j ON j.id = e."jobId"
     WHERE e."orgId" = v_org
     GROUP BY j."eeoJobCategory", e.gender, e.ethnicity
     ORDER BY 1, 2, 3;
END;
$$;

GRANT EXECUTE ON FUNCTION app_can_file_eeo() TO hris_app;
GRANT EXECUTE ON FUNCTION app_eeo_filing() TO hris_app;

-- ── The export audit trail ───────────────────────────────────────────────────────────────────
-- APPEND-ONLY, the same DB-level guarantee as ApplicationEvent and EmployeeAuditLog: SELECT and
-- INSERT policies only, no UPDATE or DELETE policy at all, and the privileges revoked outright so
-- the refusal is a loud "permission denied" rather than a silent zero-row update.
--
-- An audit trail its own subject can edit is not an audit trail.
ALTER TABLE "EeoExportLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY eeo_export_log_read ON "EeoExportLog" FOR SELECT
  USING ("orgId" = current_setting('app.current_org_id', true) AND app_can_read_eeo());

-- WITH CHECK judges the NEW ROW's own columns — no lookup of a row that doesn't exist yet (the M5
-- lesson). Anyone permitted to produce an export may record having done so.
CREATE POLICY eeo_export_log_insert ON "EeoExportLog" FOR INSERT
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true) AND app_can_read_eeo());

REVOKE UPDATE, DELETE ON "EeoExportLog" FROM hris_app;
