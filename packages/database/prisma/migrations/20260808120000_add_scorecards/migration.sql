-- CreateEnum
CREATE TYPE "ScorecardStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateTable
CREATE TABLE "JobCompetency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "status" "ScorecardStatus" NOT NULL DEFAULT 'DRAFT',
    "recommendation" "Recommendation",
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "interviewRoundId" TEXT,
    "authorEmployeeId" TEXT NOT NULL,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardRating" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scorecardId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "competencyName" TEXT NOT NULL,

    CONSTRAINT "ScorecardRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobCompetency_jobId_idx" ON "JobCompetency"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCompetency_jobId_position_key" ON "JobCompetency"("jobId", "position");

-- CreateIndex
CREATE INDEX "Scorecard_applicationId_idx" ON "Scorecard"("applicationId");

-- CreateIndex
CREATE INDEX "Scorecard_jobId_idx" ON "Scorecard"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_applicationId_interviewRoundId_authorEmployeeId_key" ON "Scorecard"("applicationId", "interviewRoundId", "authorEmployeeId");

-- CreateIndex
CREATE INDEX "ScorecardRating_scorecardId_idx" ON "ScorecardRating"("scorecardId");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardRating_scorecardId_competencyId_key" ON "ScorecardRating"("scorecardId", "competencyId");

-- AddForeignKey
ALTER TABLE "JobCompetency" ADD CONSTRAINT "JobCompetency_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_interviewRoundId_fkey" FOREIGN KEY ("interviewRoundId") REFERENCES "InterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardRating" ADD CONSTRAINT "ScorecardRating_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardRating" ADD CONSTRAINT "ScorecardRating_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "JobCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- RLS (hand-added). M7 introduces the suite's THIRD access shape.
--
-- Until now the ATS had two: app_can_see_job (the whole hiring team) and app_can_manage_job
-- (recruiters + hiring managers; interviewers deliberately excluded). Neither fits feedback, where
-- an interviewer must be able to write — but only their OWN row — and where reading is governed by
-- a rule that has nothing to do with rank:
--
--   AN INTERVIEWER MAY NOT READ A COLLEAGUE'S FEEDBACK UNTIL THEY HAVE SUBMITTED THEIR OWN.
--
-- That is the anti-anchoring guard every serious hiring process uses: the first confident opinion
-- in the room drags everyone after it, so nobody gets to read the room before going on record.
-- It lives HERE, not in the UI, because a rule you can defeat by editing a URL isn't a rule.
--
-- SECURITY DEFINER is REQUIRED here, not stylistic: these functions read "Scorecard", which is
-- itself RLS'd by the very policy that calls them — without it, the policy would recurse into
-- itself. Running as the owner reads the underlying rows once and answers a plain boolean.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- May the caller SEE a particular scorecard?
CREATE OR REPLACE FUNCTION app_can_see_scorecard(p_job_id text, p_application_id text, p_author text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Recruiters + hiring managers run the debrief; they need the whole picture at all times.
    app_can_manage_job(p_job_id)
    -- Your own feedback is always yours to read.
    OR p_author = current_setting('app.current_employee_id', true)
    -- Otherwise: on the team AND already on record for THIS candidate.
    OR (
      app_can_see_job(p_job_id)
      AND EXISTS (
        SELECT 1 FROM "Scorecard" s
        WHERE s."applicationId" = p_application_id
          AND s."authorEmployeeId" = current_setting('app.current_employee_id', true)
          AND s.status = 'SUBMITTED'
      )
    )
$$;

-- May the caller EDIT it? Only the author, and only while it is still a draft. Used as the UPDATE
-- policy's USING clause, which is what makes "submitted is final" a database guarantee rather than
-- an app convention — no action, and no bug in one, can rewrite submitted feedback.
CREATE OR REPLACE FUNCTION app_can_edit_scorecard(p_scorecard_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Scorecard" s
    WHERE s.id = p_scorecard_id
      AND s."authorEmployeeId" = current_setting('app.current_employee_id', true)
      AND s.status = 'DRAFT'
  )
$$;

-- Resolve a scorecard's own columns (bypassing RLS) and delegate. Lets ScorecardRating inherit its
-- parent's visibility without denormalising jobId/applicationId/author onto every rating row.
CREATE OR REPLACE FUNCTION app_can_see_scorecard_by_id(p_scorecard_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_can_see_scorecard(s."jobId", s."applicationId", s."authorEmployeeId")
  FROM "Scorecard" s WHERE s.id = p_scorecard_id
$$;

GRANT EXECUTE ON FUNCTION app_can_see_scorecard(text, text, text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_edit_scorecard(text)            TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_see_scorecard_by_id(text)       TO hris_app;

-- JobCompetency — read with the job, write with manage rights (the InterviewRound pair, verbatim).
ALTER TABLE "JobCompetency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_competency_read ON "JobCompetency" FOR SELECT
  USING (app_can_see_job("jobId"));
CREATE POLICY job_competency_write ON "JobCompetency" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

-- Scorecard. Note the three separate policies — this table needs genuinely different rules per verb:
--   SELECT → the anchoring guard
--   INSERT → you may only create feedback AUTHORED BY YOU, on a job you're on. Judged against the
--            NEW ROW'S OWN COLUMNS (the M5 lesson: a lookup-based check can't see a row mid-insert).
--   UPDATE → author + still DRAFT.
-- There is deliberately NO DELETE policy: feedback, once given, is never removed.
ALTER TABLE "Scorecard" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scorecard_read ON "Scorecard" FOR SELECT
  USING (app_can_see_scorecard("jobId", "applicationId", "authorEmployeeId"));
CREATE POLICY scorecard_insert ON "Scorecard" FOR INSERT
  WITH CHECK (
    "authorEmployeeId" = current_setting('app.current_employee_id', true)
    AND app_can_see_job("jobId")
  );
CREATE POLICY scorecard_update ON "Scorecard" FOR UPDATE
  USING (app_can_edit_scorecard(id))
  WITH CHECK (app_can_edit_scorecard(id));

-- ScorecardRating inherits the parent's rules through the *_by_id helper.
ALTER TABLE "ScorecardRating" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scorecard_rating_read ON "ScorecardRating" FOR SELECT
  USING (app_can_see_scorecard_by_id("scorecardId"));
CREATE POLICY scorecard_rating_write ON "ScorecardRating" FOR ALL
  USING (app_can_edit_scorecard("scorecardId"))
  WITH CHECK (app_can_edit_scorecard("scorecardId"));
