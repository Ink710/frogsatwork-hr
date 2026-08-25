-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M8 — STAGE-CHANGE NOTIFICATIONS
--
-- Three things land here.
--
-- (1) `Candidate.locale` — the language we write to a person in. It has to live on the PERSON
--     because locale everywhere else is read from a cookie on the CURRENT REQUEST, and a
--     stage-change email is triggered by a RECRUITER's request. Without this column every applicant
--     would be emailed in whichever language the recruiter happens to browse in, and it would look
--     perfectly fine in development because everyone tests in English.
--
-- (2) `NotificationDelivery` — a record of what we tried to SEND. Not "a notification": the
--     notification is the `ApplicationEvent`, which already exists and is append-only. Holds no
--     personal data, which is why app_erase_candidate is deliberately NOT changed by this migration.
--
-- (3) `app_submit_application` collapses its 16 positional parameters into ONE jsonb payload. The
--     standing note said the next change that needed a parameter should do this rather than add a
--     seventeenth; capturing the locale is that change. It also starts returning `event_id`, which
--     the receipt email cannot work without — see below.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "Candidate" ADD COLUMN "locale" text;

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
CREATE TYPE "NotificationStatus"  AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "NotificationDelivery" (
  "id"                 text                  NOT NULL,
  "channel"            "NotificationChannel" NOT NULL,
  "status"             "NotificationStatus"  NOT NULL DEFAULT 'PENDING',
  "attemptedAt"        timestamp(3),
  "createdAt"          timestamp(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applicationEventId" text                  NOT NULL,
  "jobId"              text                  NOT NULL,
  "recipientUserId"    text,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_applicationEventId_fkey"
  FOREIGN KEY ("applicationEventId") REFERENCES "ApplicationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "NotificationDelivery_applicationEventId_idx" ON "NotificationDelivery"("applicationEventId");
CREATE INDEX "NotificationDelivery_jobId_idx" ON "NotificationDelivery"("jobId");

-- ⚠️⚠️ `NULLS NOT DISTINCT` IS THE WHOLE MECHANISM, NOT A DETAIL.
--
-- In Postgres, NULLs in a unique index are DISTINCT by default. Every row M8 writes has
-- `recipientUserId IS NULL` (the recipient is the candidate on the event), so with the default
-- behaviour two claims for the same event would NOT collide — `ON CONFLICT DO NOTHING` would never
-- fire, every claim would succeed, and a retry or a double-submit would send the same person the
-- same email twice. Nothing would error. Nothing would look wrong.
--
-- Declared here in raw SQL because Prisma cannot express it; schema.prisma carries a comment saying
-- so, and deliberately does NOT declare a `@@unique` it would get wrong.
--
-- Requires PG 15+. Dev is 16.14 and Neon is 16+, both verified.
CREATE UNIQUE INDEX "NotificationDelivery_event_channel_recipient_key"
  ON "NotificationDelivery" ("applicationEventId", "channel", "recipientUserId") NULLS NOT DISTINCT;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────
-- Readable by whoever can see the req, exactly like ApplicationAnswer and ApplicationEvent.
--
-- ⚠️ EVERY WRITE PRIVILEGE IS REVOKED. The receipt email is sent from the PUBLIC apply path, which
-- has no session and therefore no RLS identity at all — it could not write here under any policy. So
-- both writers are SECURITY DEFINER doorways, and revoking the privileges makes that the only way
-- in rather than a convention someone can forget. The ATS's own sends use the same doorways, so
-- there is one code path instead of two.
ALTER TABLE "NotificationDelivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_delivery_read ON "NotificationDelivery" FOR SELECT
  USING (app_can_see_job("jobId"));
REVOKE INSERT, UPDATE, DELETE ON "NotificationDelivery" FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_claim_notification — the atomic claim that makes sending idempotent.
--
-- Returns TRUE only to the caller that won the row. A retry, a double-submitted form, or two
-- recruiters moving the same application at once all lose and skip, because the unique index above
-- decides — not a read-then-write in application code, which would race.
--
-- Also RE-CLAIMS a FAILED row, so a send that failed for a transient reason can be attempted again.
-- Deliberately does NOT re-claim a PENDING one: a PENDING row means a claim was made and never
-- marked (a crash between the two), and re-sending is worse than not sending.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_claim_notification(
  p_event_id          text,
  p_channel           text,
  p_recipient_user_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id  text;
  v_claimed text;
BEGIN
  -- The event carries the owner column, so the caller never supplies a jobId it could get wrong.
  SELECT e."jobId" INTO v_job_id FROM "ApplicationEvent" e WHERE e.id = p_event_id;
  IF v_job_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO "NotificationDelivery"
    (id, channel, status, "createdAt", "applicationEventId", "jobId", "recipientUserId")
  VALUES
    (gen_random_uuid()::text, p_channel::"NotificationChannel", 'PENDING', now(),
     p_event_id, v_job_id, p_recipient_user_id)
  ON CONFLICT ("applicationEventId", "channel", "recipientUserId") DO UPDATE
    SET status = 'PENDING', "attemptedAt" = NULL
    WHERE "NotificationDelivery".status = 'FAILED'
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

-- Record how it went. `IS NOT DISTINCT FROM` rather than `=` because the recipient is normally NULL,
-- and `NULL = NULL` is NULL — an equality test would match nothing and every send would stay PENDING.
CREATE OR REPLACE FUNCTION app_mark_notification(
  p_event_id          text,
  p_channel           text,
  p_status            text,
  p_recipient_user_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE "NotificationDelivery"
     SET status = p_status::"NotificationStatus", "attemptedAt" = now()
   WHERE "applicationEventId" = p_event_id
     AND channel = p_channel::"NotificationChannel"
     AND "recipientUserId" IS NOT DISTINCT FROM p_recipient_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION app_claim_notification(text, text, text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_mark_notification(text, text, text, text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — SIXTEEN POSITIONAL PARAMETERS COLLAPSED INTO ONE jsonb PAYLOAD.
--
-- ⚠️ DROP/CREATE, not CREATE OR REPLACE: both the signature and the return type change. The old
-- 16-argument function must be dropped by its FULL signature, and the GRANT re-issued with it.
--
-- WHY NOW: the rule recorded after M6b was that the next change needing a parameter should collapse
-- the payload rather than add a seventeenth. Capturing `locale` is that change. Since a DROP/CREATE
-- is required either way, the only marginal cost is the call sites — and there are four.
--
-- ⚠️ `event_id` IS RETURNED, AND THE RECEIPT EMAIL CANNOT WORK WITHOUT IT. The apply path is
-- anonymous, and "ApplicationEvent" is RLS'd by app_can_see_job, so the caller CANNOT read back the
-- APPLIED event it just caused. Without the id there is nothing to key the delivery record on, and
-- the receipt would either be unrecorded or sent twice on a retry.
--
-- Behaviour is otherwise UNCHANGED from M7. Every guard, discard and snapshot below is a port of the
-- live definition, not a rewrite.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION app_submit_application(
  text, text, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, text, jsonb);

CREATE FUNCTION app_submit_application(p_job_id text, p_payload jsonb)
RETURNS TABLE(result text, application_id text, event_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id       text;
  -- ⇩ The payload, unpacked once. `->` yields a JSON null (not SQL NULL) when a key is present but
  --   null, so the three jsonb fields are passed through NULLIF: "absent" and "explicitly null" must
  --   both mean "not submitted", which is what the IF blocks below test for.
  v_first_name   text  := p_payload->>'firstName';
  v_last_name    text  := p_payload->>'lastName';
  v_email        text  := lower(btrim(p_payload->>'email'));
  v_phone        text  := p_payload->>'phone';
  v_source       text  := p_payload->>'source';
  v_in_key       text  := p_payload->>'resumeKey';
  v_in_name      text  := p_payload->>'resumeName';
  v_locale       text  := p_payload->>'locale';
  v_consent      text  := p_payload->>'consentVersion';
  v_eeo          jsonb := COALESCE(NULLIF(p_payload->'eeo', 'null'::jsonb), '{}'::jsonb);
  v_employment   jsonb := NULLIF(p_payload->'employment', 'null'::jsonb);
  v_education    jsonb := NULLIF(p_payload->'education',  'null'::jsonb);
  v_answers      jsonb := NULLIF(p_payload->'answers',    'null'::jsonb);
  v_candidate_id text;
  v_existing_id  text;
  v_app_id       text;
  v_event_id     text;
  v_campaign_id  text;
  v_source_label text;
  v_missing      integer;
  -- M7: what THIS application is submitted with — the attached file if there is one, otherwise
  -- whatever CV is already on file for the person.
  v_resume_key   text;
  v_resume_name  text;
  v_system_user  text := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- (1)+(2) Derive the org from the job, and only for a job that is genuinely on offer.
  SELECT j."orgId" INTO v_org_id
  FROM "Job" j
  WHERE j.id = p_job_id AND j.status = 'OPEN' AND j."publishedAt" IS NOT NULL;

  IF v_org_id IS NULL THEN
    RETURN QUERY SELECT 'CLOSED'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- (0a) M6b: REQUIRED ANSWERS. Checked here, before a single row is written, so a submission that
  --      cannot be accepted never creates a half-application.
  --
  --      ⚠️ ENFORCED IN THE DATABASE, NOT JUST THE FORM. This is a public endpoint; a "required"
  --      field that only the browser enforces is not required at all. Same posture as M2's campaign
  --      slugs: the app layer validates for a good error message, the function decides.
  SELECT count(*) INTO v_missing
  FROM "JobQuestion" q
  WHERE q."jobId" = p_job_id
    AND q.required
    AND q."archivedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_answers, '[]'::jsonb)) a
      WHERE a->>'questionId' = q.id AND btrim(COALESCE(a->>'value', '')) <> ''
    );

  IF v_missing > 0 THEN
    RETURN QUERY SELECT 'MISSING_ANSWERS'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- (0) M2: resolve the source as a campaign SLUG within THIS job's org. Both outputs stay NULL when
  --     there is no live campaign by that slug, which is what discards unrecognised input. Scoping
  --     to v_org_id (derived from the job, never supplied by the caller) also means a slug from one
  --     org can never attribute an application in another.
  IF v_source IS NOT NULL THEN
    SELECT c.id, c.name INTO v_campaign_id, v_source_label
    FROM "Campaign" c
    WHERE c."orgId" = v_org_id
      AND c.slug = lower(btrim(v_source))
      AND c."archivedAt" IS NULL;
  END IF;

  -- (3) Dedupe the person on (org, email). M7 reads the CV on file in the same trip, because the
  --     application needs to pin it and a second SELECT would only be the same row again.
  SELECT c.id, c."resumeKey", c."resumeFileName"
    INTO v_candidate_id, v_resume_key, v_resume_name
  FROM "Candidate" c
  WHERE c."orgId" = v_org_id AND lower(c.email) = v_email;

  -- (4) M7: ALREADY APPLIED TO THIS JOB? Say so, and write nothing at all. This check sits ABOVE the
  --     candidate write on purpose: below it, a refused submission gap-filled the candidate row with
  --     a résumé key whose blob the caller then deleted, leaving the row pointing at a missing file.
  IF v_candidate_id IS NOT NULL THEN
    SELECT a.id INTO v_existing_id
    FROM "Application" a
    WHERE a."jobId" = p_job_id AND a."candidateId" = v_candidate_id;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_existing_id, NULL::text;
      RETURN;
    END IF;
  END IF;

  IF v_candidate_id IS NULL THEN
    v_candidate_id := gen_random_uuid()::text;
    v_resume_key   := v_in_key;
    v_resume_name  := v_in_name;
    INSERT INTO "Candidate" (id, "firstName", "lastName", email, phone, source, locale,
                             "resumeKey", "resumeFileName", "createdAt", "updatedAt", "orgId")
    VALUES (v_candidate_id, v_first_name, v_last_name, v_email, v_phone, v_source_label, v_locale,
            v_in_key, v_in_name, now(), now(), v_org_id);
  ELSE
    -- (5) Only fill gaps; never overwrite what an existing candidate already has on file. For
    --     `source` this is what makes the column mean FIRST TOUCH. For the résumé it is a SECURITY
    --     property: this endpoint resolves a person by EMAIL, never by session, so a submission that
    --     could overwrite the candidate row would let anyone who knows an address replace the CV on
    --     that person's profile. `locale` joins the same rule — first touch wins.
    UPDATE "Candidate"
       SET phone            = COALESCE(phone, v_phone),
           source           = COALESCE(source, v_source_label),
           locale           = COALESCE(locale, v_locale),
           "resumeKey"      = COALESCE("resumeKey", v_in_key),
           -- Tied to the key, not coalesced on its own, so a new file can never end up displayed
           -- under the previous file's name.
           "resumeFileName" = CASE WHEN "resumeKey" IS NULL THEN v_in_name
                                   ELSE "resumeFileName" END,
           "updatedAt"      = now()
     WHERE id = v_candidate_id;

    -- M7: an attached file is what THIS application carries, whatever the profile keeps.
    IF v_in_key IS NOT NULL THEN
      v_resume_key  := v_in_key;
      v_resume_name := v_in_name;
    END IF;
  END IF;

  v_app_id   := gen_random_uuid()::text;
  v_event_id := gen_random_uuid()::text;

  INSERT INTO "Application" (id, stage, "appliedAt", "createdAt", "updatedAt",
                             source, "campaignId",
                             -- ⇩ M6: frozen copies of what was submitted.
                             "employmentSnapshot", "educationSnapshot",
                             -- ⇩ M7: and the CV it was submitted with.
                             "resumeKey", "resumeFileName",
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(),
          v_source_label, v_campaign_id,
          v_employment, v_education,
          v_resume_key, v_resume_name,
          v_org_id, p_job_id, v_candidate_id);

  -- (6) The append-only trail starts here, attributed to the system actor. M8: the id is generated
  --     above rather than defaulted, because the caller needs it back to key the receipt email.
  INSERT INTO "ApplicationEvent" (id, "fromStage", "toStage", "occurredAt",
                                  "applicationId", "jobId", "actorId")
  VALUES (v_event_id, NULL, 'APPLIED', now(), v_app_id, p_job_id, v_system_user);

  -- (7)+(8) The voluntary EEO answers. Unrecognised input degrades to DECLINED rather than raising.
  INSERT INTO "EeoResponse" (id, gender, ethnicity, "veteranStatus", "disabilityStatus",
                             "submittedAt", "orgId", "applicationId", "jobId")
  VALUES (
    gen_random_uuid()::text,
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoGender")) x
               WHERE x::text = v_eeo->>'gender'), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoEthnicity")) x
               WHERE x::text = v_eeo->>'ethnicity'), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoVeteranStatus")) x
               WHERE x::text = v_eeo->>'veteran'), 'DECLINED'),
    COALESCE((SELECT x FROM unnest(enum_range(NULL::"EeoDisabilityStatus")) x
               WHERE x::text = v_eeo->>'disability'), 'DECLINED'),
    now(), v_org_id, v_app_id, p_job_id);

  -- ▼ M6: the PROFILE and the CONSENT record.
  --
  -- Submitting REPLACES the profile with what was just submitted — that is what "profile master,
  -- snapshot at submit" means in practice: one form, two destinations. The application already has
  -- its frozen copy above, so rewriting the profile cannot disturb anything under review.
  --
  -- Delete-then-insert rather than a diff: the form posts the whole history every time, so there is
  -- no partial update to reconcile, and matching rows up by identity would invent an editing model
  -- the UI does not have.
  IF v_employment IS NOT NULL THEN
    DELETE FROM "CandidateEmployment" WHERE "candidateId" = v_candidate_id;
    INSERT INTO "CandidateEmployment"
      (id, employer, title, "startDate", "endDate", summary, position,
       "createdAt", "updatedAt", "candidateId")
    SELECT gen_random_uuid()::text,
           e->>'employer', e->>'title',
           (e->>'startDate')::timestamp(3),
           NULLIF(e->>'endDate','')::timestamp(3),
           NULLIF(e->>'summary',''),
           COALESCE((e->>'position')::int, ord::int),
           now(), now(), v_candidate_id
    FROM jsonb_array_elements(v_employment) WITH ORDINALITY AS t(e, ord);
  END IF;

  IF v_education IS NOT NULL THEN
    DELETE FROM "CandidateEducation" WHERE "candidateId" = v_candidate_id;
    INSERT INTO "CandidateEducation"
      (id, institution, qualification, "startDate", "endDate", position,
       "createdAt", "updatedAt", "candidateId")
    SELECT gen_random_uuid()::text,
           e->>'institution', e->>'qualification',
           NULLIF(e->>'startDate','')::timestamp(3),
           NULLIF(e->>'endDate','')::timestamp(3),
           COALESCE((e->>'position')::int, ord::int),
           now(), now(), v_candidate_id
    FROM jsonb_array_elements(v_education) WITH ORDINALITY AS t(e, ord);
  END IF;

  -- Consent is recorded against the APPLICATION, not the person: it attests to this submission
  -- under a named policy version. NULL means the caller did not collect it (the ATS careers page,
  -- which predates the consent flow) — recording a consent nobody gave would be worse than none.
  IF v_consent IS NOT NULL THEN
    INSERT INTO "ApplicationConsent" (id, "policyVersion", "acceptedAt", "applicationId", "jobId")
    VALUES (gen_random_uuid()::text, v_consent, now(), v_app_id, p_job_id);
  END IF;
  -- ▲ END M6

  -- ▼ M6b: the answers.
  --
  -- The JOIN to "JobQuestion" is the filter, and it is doing real work: an answer whose questionId
  -- belongs to a DIFFERENT job, or to an ARCHIVED question, simply does not join and is silently
  -- discarded. Same discard-don't-record posture as an unrecognised campaign slug — a caller cannot
  -- smuggle arbitrary rows in by inventing ids.
  --
  -- The prompt is SNAPSHOTTED here, so rewording the question later cannot change what a past
  -- applicant appears to have been asked.
  IF v_answers IS NOT NULL THEN
    INSERT INTO "ApplicationAnswer" (id, "promptSnapshot", value, "createdAt",
                                     "applicationId", "questionId", "jobId")
    SELECT gen_random_uuid()::text, q.prompt, btrim(a->>'value'), now(),
           v_app_id, q.id, p_job_id
    FROM jsonb_array_elements(v_answers) a
    JOIN "JobQuestion" q
      ON q.id = a->>'questionId'
     AND q."jobId" = p_job_id
     AND q."archivedAt" IS NULL
    WHERE btrim(COALESCE(a->>'value', '')) <> '';
  END IF;
  -- ▲ END M6b

  RETURN QUERY SELECT 'OK'::text, v_app_id, v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_submit_application(text, jsonb) TO hris_app;
