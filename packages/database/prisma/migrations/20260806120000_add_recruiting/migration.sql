-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED', 'FILLED');

-- CreateEnum
CREATE TYPE "JobMemberRole" AS ENUM ('RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RECRUITER';

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMember" (
    "id" TEXT NOT NULL,
    "role" "JobMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "JobMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "resumeKey" TEXT,
    "resumeFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "currentRoundId" TEXT,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "fromStage" "ApplicationStage",
    "toStage" "ApplicationStage" NOT NULL,
    "roundName" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_orgId_status_idx" ON "Job"("orgId", "status");

-- CreateIndex
CREATE INDEX "InterviewRound_jobId_idx" ON "InterviewRound"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRound_jobId_position_key" ON "InterviewRound"("jobId", "position");

-- CreateIndex
CREATE INDEX "JobMember_employeeId_idx" ON "JobMember"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMember_jobId_employeeId_key" ON "JobMember"("jobId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_orgId_email_key" ON "Candidate"("orgId", "email");

-- CreateIndex
CREATE INDEX "Application_jobId_stage_idx" ON "Application"("jobId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_candidateId_key" ON "Application"("jobId", "candidateId");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_occurredAt_idx" ON "ApplicationEvent"("applicationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_currentRoundId_fkey" FOREIGN KEY ("currentRoundId") REFERENCES "InterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- RLS (hand-added). The ATS access model is per-job HIRING TEAM, not org-chart subtree. Three
-- SECURITY DEFINER helpers read the app.current_* session vars set by withViewer:
--   app_can_see_job       — recruiting roles (HR / RECRUITER) org-wide, OR any JobMember of the job
--   app_can_manage_job    — recruiting roles, OR a JobMember whose role is HIRING_MANAGER / RECRUITER
--                           (INTERVIEWERs are excluded → read-only in M1)
--   app_can_see_candidate — recruiting roles, OR a candidate with an application to a visible job
-- Read/write policy split (like Shift): a FOR SELECT policy on app_can_see_job + a FOR ALL policy on
-- app_can_manage_job. ApplicationEvent is additionally APPEND-ONLY: UPDATE/DELETE are revoked from
-- hris_app (the same DB-level guarantee as EmployeeAuditLog). Being SECURITY DEFINER, the helpers run
-- as the table owner and bypass RLS on the tables they read, so there is no policy recursion.
-- No explicit table GRANTs: ALTER DEFAULT PRIVILEGES (audit_append_only) already grants new tables to hris_app.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app_can_see_job(job_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Job" j
    WHERE j.id = job_id
      AND j."orgId" = current_setting('app.current_org_id', true)
      AND (
        current_setting('app.current_role', true) IN
          ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
        OR EXISTS (
          SELECT 1 FROM "JobMember" m
          WHERE m."jobId" = j.id
            AND m."employeeId" = current_setting('app.current_employee_id', true)
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_manage_job(job_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Job" j
    WHERE j.id = job_id
      AND j."orgId" = current_setting('app.current_org_id', true)
      AND (
        current_setting('app.current_role', true) IN
          ('HR_ADMIN', 'RECRUITER', 'SYSTEM')
        OR EXISTS (
          SELECT 1 FROM "JobMember" m
          WHERE m."jobId" = j.id
            AND m."employeeId" = current_setting('app.current_employee_id', true)
            AND m.role IN ('HIRING_MANAGER', 'RECRUITER')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_see_candidate(cand_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Candidate" c
    WHERE c.id = cand_id
      AND c."orgId" = current_setting('app.current_org_id', true)
      AND (
        current_setting('app.current_role', true) IN
          ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
        OR EXISTS (
          SELECT 1 FROM "Application" a
          WHERE a."candidateId" = c.id
            AND app_can_see_job(a."jobId")
        )
      )
  )
$$;

GRANT EXECUTE ON FUNCTION app_can_see_job(text)       TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_manage_job(text)    TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_see_candidate(text) TO hris_app;

-- Job — hiring-team read, manager/recruiter write.
ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_read ON "Job" FOR SELECT
  USING (app_can_see_job(id));
CREATE POLICY job_write ON "Job" FOR ALL
  USING (app_can_manage_job(id))
  WITH CHECK (app_can_manage_job(id));

-- InterviewRound — visible with the job, editable by job managers.
ALTER TABLE "InterviewRound" ENABLE ROW LEVEL SECURITY;
CREATE POLICY interview_round_read ON "InterviewRound" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY interview_round_write ON "InterviewRound" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

-- JobMember — visible with the job, editable by job managers.
ALTER TABLE "JobMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_member_read ON "JobMember" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY job_member_write ON "JobMember" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

-- Candidate — a person; visible to recruiting roles or anyone who can see one of their applications.
ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_visibility ON "Candidate" FOR ALL
  USING (app_can_see_candidate(id))
  WITH CHECK (app_can_see_candidate(id));

-- Application — the pipeline unit. Read with the job; stage moves require manage rights.
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_read ON "Application" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY application_write ON "Application" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

-- ApplicationEvent — readable with the job; APPEND-ONLY. Inserts require manage rights (only a
-- decision-maker records a move); UPDATE/DELETE are revoked so history can never be rewritten.
ALTER TABLE "ApplicationEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_event_read ON "ApplicationEvent" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY application_event_insert ON "ApplicationEvent" FOR INSERT
  WITH CHECK (app_can_manage_job("jobId"));
REVOKE UPDATE, DELETE ON "ApplicationEvent" FROM hris_app;

