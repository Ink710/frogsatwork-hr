-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M13 — THE SCREENING CALL WINDOW
--
-- The requirement changed shape late and it is worth recording WHY, because the discarded design is
-- the one a reader would expect to find here.
--
-- The original M13 was candidate SELF-BOOKING for the screening stage, which meant making
-- InterviewSlot."roundId" nullable — rounds exist only while an application is AT the interview
-- stage. That turns the once-per-round unique index into a once-per-(application, round-or-stage)
-- one, and NULLs in a Postgres unique index are DISTINCT by default, so the naive version silently
-- allows a candidate to book several screening calls with no error anywhere.
--
-- ⚠️ AND THE OBVIOUS FIX WOULD HAVE BEEN WORSE THAN THE BUG. M8 solved that same NULL trap on
-- NotificationDelivery with NULLS NOT DISTINCT, but that clause is a WHOLE-INDEX property and
-- ("claimedByApplicationId", "roundId") has TWO nullable columns with OPPOSITE requirements:
-- an unclaimed slot's NULL applicationId must stay DISTINCT (that is what lets a POOL of unclaimed
-- slots exist at all — see the comment on InterviewSlot), while a screening booking's NULL roundId
-- must be NOT DISTINCT. Applying M8's fix wholesale would have refused the second unclaimed slot for
-- a round, destroying the shared pool that is M9 decision 2. (Proven on temp tables before any of
-- this was written; the shape that does work is a PARTIAL index —
-- NULLS NOT DISTINCT WHERE "claimedByApplicationId" IS NOT NULL — kept here in case self-booking
-- for screening is ever wanted again.)
--
-- Julian's call instead: recruiters run screening calls themselves, and the applicant is simply TOLD
-- when to be reachable. So there is no slot, no claim, no index — three columns on the req and one
-- more thing the existing portal doorway returns.
--
-- No new table and no personal data: a call window is the recruiting team's phone hours, not a fact
-- about any candidate. `app_erase_candidate` is deliberately UNCHANGED, the same call M9 made for
-- InterviewSlot and M2 made for Campaign.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── The window itself ────────────────────────────────────────────────────────────────────────
--
-- ⚠️ THIS IS THE ONE PLACE `Meeting`'s IDIOM BEATS `Shift`'s — the exact reverse of what M9 argued
-- for InterviewSlot, and deliberately so. A slot is a specific instant ("Tuesday 3 March, 15:00"),
-- so it stores real timestamps. A call window is a RECURRING WALL CLOCK with no date at all
-- ("we call between 9 and 5, most days"), which a timestamp cannot express: any instant we stored
-- would have to invent a day, and the day is precisely what nobody has committed to yet.
--
-- So: "HH:MM" strings plus the IANA zone they are read in. The zone is NOT decoration — 9:00 means
-- nothing to a candidate in another country without it, and it is rendered next to the hours
-- everywhere, the same discipline formatSlotWhen follows for slots.
ALTER TABLE "Job" ADD COLUMN "screeningCallFrom"     TEXT;
ALTER TABLE "Job" ADD COLUMN "screeningCallTo"       TEXT;
ALTER TABLE "Job" ADD COLUMN "screeningCallTimeZone" TEXT;

-- ⚠️ ALL THREE OR NONE, ENFORCED HERE AND NOT ONLY IN ZOD. A half-configured window is the one state
-- that produces a message a candidate cannot act on ("be available between 09:00 and —"), and this
-- project's standing line is that a rule enforced only in a server action is not enforced. Same
-- argument that put required-answer checking inside app_submit_application in M6b.
--
-- `from < to` is a plain text comparison, which is chronological ONLY because the format check in
-- the same conjunction guarantees both sides are zero-padded fixed-width "HH:MM". Do not relax the
-- regex without revisiting it. It also rules out a window that wraps midnight — deliberate: an
-- overnight recruiting call window is far more likely to be 17:00 typed into the wrong box than a
-- real intention, and the honest failure is a rejected save.
ALTER TABLE "Job" ADD CONSTRAINT "Job_screening_call_window_ck" CHECK (
  num_nonnulls("screeningCallFrom", "screeningCallTo", "screeningCallTimeZone") = 0
  OR (
    num_nonnulls("screeningCallFrom", "screeningCallTo", "screeningCallTimeZone") = 3
    AND "screeningCallFrom" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "screeningCallTo"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "screeningCallFrom" < "screeningCallTo"
  )
);

-- ── The portal doorway learns about it ───────────────────────────────────────────────────────
--
-- ⚠️ DROPPED AND RECREATED, NOT `CREATE OR REPLACE`d. Adding columns to a RETURNS TABLE changes the
-- function's RETURN TYPE, and Postgres refuses to replace a function whose return type differs
-- ("cannot change return type of existing function"). The GRANT goes with it and must be re-issued.
-- Same trap M6 hit adding parameters to app_submit_application and M7 hit widening
-- app_erase_candidate's return to resume_keys text[].
--
-- ⚠️ THE WINDOW IS RETURNED ONLY WHILE THE APPLICATION IS AT SCREEN, and that is a decision, not an
-- optimisation. M5 drew the line as "the database decides what you may SEE, TypeScript decides what
-- it's CALLED": gating here means the hours cannot be rendered at the wrong stage by a page that
-- forgets to check, and they never reach the RSC payload of an application they do not concern.
DROP FUNCTION IF EXISTS app_applicant_applications(text);

CREATE FUNCTION app_applicant_applications(p_account_id text)
RETURNS TABLE (
  application_id           text,
  job_title                text,
  job_location             text,
  applied_at               timestamp(3),
  stage                    text,
  screening_call_from      text,
  screening_call_to        text,
  screening_call_time_zone text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, j.title, j.location, a."appliedAt", a.stage::text,
         CASE WHEN a.stage = 'SCREEN' THEN j."screeningCallFrom"     END,
         CASE WHEN a.stage = 'SCREEN' THEN j."screeningCallTo"       END,
         CASE WHEN a.stage = 'SCREEN' THEN j."screeningCallTimeZone" END
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  JOIN "Application"      a ON a."candidateId" = c.id
  JOIN "Job"              j ON j.id = a."jobId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
  ORDER BY a."appliedAt" DESC
$$;

GRANT EXECUTE ON FUNCTION app_applicant_applications(text) TO hris_app;
