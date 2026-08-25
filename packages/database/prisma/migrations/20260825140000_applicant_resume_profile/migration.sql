-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M7 — RÉSUMÉ SELF-MANAGEMENT + THE PROFILE EDITOR
--
-- Two things land here.
--
-- (1) THE RÉSUMÉ FINALLY JOINS THE SNAPSHOT FAMILY. M6 froze work history and education onto the
--     application (employmentSnapshot / educationSnapshot) so that editing a profile could not
--     change an application under review. The résumé escaped that rule only because nobody could
--     replace one yet — Candidate.resumeKey doubled as "what they applied with". M7 gives an
--     applicant the ability to replace their CV, so the key is now PINNED onto the application.
--
--     The blob is SHARED, NOT COPIED: an application stores the key that was current at submit, and
--     replacing a CV writes a new blob and repoints the candidate row only.
--
--     ⚠️ NO KEY MAY EVER BECOME UNREFERENCED, and that is load-bearing rather than tidy:
--     app_erase_candidate sweeps object storage using keys it READS FROM THE DATABASE, so an
--     orphaned blob is a blob an erasure cannot destroy. Every path below is written to preserve
--     that invariant, and the erasure function now collects DISTINCT keys across both tables.
--
-- (2) THE APPLICANT CAN WRITE THEIR OWN RECORD. Through doorways, for the reason this project keeps
--     rediscovering — see the block above app_applicant_save_profile.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── The pin ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Application" ADD COLUMN "resumeKey" text;
ALTER TABLE "Application" ADD COLUMN "resumeFileName" text;

-- Only ever read as "does any application still pin this key" (app_applicant_set_resume).
CREATE INDEX "Application_resumeKey_idx" ON "Application"("resumeKey");

-- No RLS or GRANT work: "Application" policies are table-level and hris_app's privileges arrive
-- through ALTER DEFAULT PRIVILEGES, so new columns inherit both.

-- BACKFILL. Accurate rather than invented: no CV could be replaced before this migration existed,
-- so the candidate's current file IS the file every one of their applications was submitted with.
UPDATE "Application" a
   SET "resumeKey"      = c."resumeKey",
       "resumeFileName" = c."resumeFileName"
  FROM "Candidate" c
 WHERE c.id = a."candidateId"
   AND c."resumeKey" IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_submit_application — REPLACED to pin the résumé onto the application.
--
-- ⚠️ SIGNATURE UNCHANGED, so this is a genuine CREATE OR REPLACE and needs no re-GRANT. That is
-- deliberate: the function is at 16 parameters after three DROP/CREATE cycles, and the standing note
-- is that the NEXT change needing a parameter should collapse the payload into one jsonb argument
-- rather than adding a seventeenth. This change needs no parameter — p_resume_key already exists.
--
-- ⚠️ THE CANDIDATE-ROW GAP-FILL (COALESCE) IS CORRECT AND STAYS. It looks like the bug — a returning
-- applicant's new CV appearing to be ignored — but overwriting Candidate.resumeKey from here would
-- be far worse. This endpoint resolves a person by EMAIL, never by session (deliberately: see the
-- comment in the portal's apply action). If a submission could overwrite the candidate row's CV,
-- anyone who knows an applicant's address could replace the CV in their profile. The real defect was
-- that the uploaded file was never PINNED anywhere: accepted, stored, and referenced by nothing.
--
-- TWO OTHER CHANGES, both about not leaving a key pointing at a file that is gone:
--
--   · The filename is tied to the KEY with a CASE instead of its own COALESCE. Two independent
--     coalesces can leave a stale filename beside a new key whenever p_resume_name is null.
--
--   · ⚠️ THE DUPLICATE CHECK MOVED ABOVE THE CANDIDATE WRITE. It used to sit below, so a second
--     submission to the SAME job by someone with no CV on file would gap-fill their candidate row
--     with the newly-uploaded key and THEN return DUPLICATE — whereupon the caller, correctly,
--     deletes the blob for a submission that was not accepted. The row was left pointing at a file
--     that no longer existed. Refusing before writing anything also matches the posture the rest of
--     this function already takes (CLOSED and MISSING_ANSWERS both refuse before a single write).
--     Side effect worth naming: phone and source are no longer gap-filled by a duplicate either,
--     which is the same discard-don't-record rule M2 established for unrecognised campaign slugs.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_submit_application(p_job_id text, p_first_name text, p_last_name text, p_email text, p_phone text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_resume_key text DEFAULT NULL::text, p_resume_name text DEFAULT NULL::text, p_eeo_gender text DEFAULT NULL::text, p_eeo_ethnicity text DEFAULT NULL::text, p_eeo_veteran text DEFAULT NULL::text, p_eeo_disability text DEFAULT NULL::text, p_employment jsonb DEFAULT NULL::jsonb, p_education jsonb DEFAULT NULL::jsonb, p_consent_version text DEFAULT NULL::text,
  p_answers jsonb DEFAULT NULL)
 RETURNS TABLE(result text, application_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org_id       text;
  v_email        text := lower(btrim(p_email));
  v_candidate_id text;
  v_existing_id  text;
  v_app_id       text;
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
    RETURN QUERY SELECT 'CLOSED'::text, NULL::text;
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
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) a
      WHERE a->>'questionId' = q.id AND btrim(COALESCE(a->>'value', '')) <> ''
    );

  IF v_missing > 0 THEN
    RETURN QUERY SELECT 'MISSING_ANSWERS'::text, NULL::text;
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

  -- (3) Dedupe the person on (org, email). M7 reads the CV on file in the same trip, because the
  --     application needs to pin it and a second SELECT would only be the same row again.
  SELECT c.id, c."resumeKey", c."resumeFileName"
    INTO v_candidate_id, v_resume_key, v_resume_name
  FROM "Candidate" c
  WHERE c."orgId" = v_org_id AND lower(c.email) = v_email;

  -- (4) M7: ALREADY APPLIED TO THIS JOB? Say so, and write nothing at all — see the header. This
  --     check used to sit after the candidate write, which left a gap-filled résumé key pointing at
  --     a blob the caller then deleted.
  IF v_candidate_id IS NOT NULL THEN
    SELECT a.id INTO v_existing_id
    FROM "Application" a
    WHERE a."jobId" = p_job_id AND a."candidateId" = v_candidate_id;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_existing_id;
      RETURN;
    END IF;
  END IF;

  IF v_candidate_id IS NULL THEN
    v_candidate_id := gen_random_uuid()::text;
    v_resume_key   := p_resume_key;
    v_resume_name  := p_resume_name;
    INSERT INTO "Candidate" (id, "firstName", "lastName", email, phone, source,
                             "resumeKey", "resumeFileName", "createdAt", "updatedAt", "orgId")
    VALUES (v_candidate_id, p_first_name, p_last_name, v_email, p_phone, v_source_label,
            p_resume_key, p_resume_name, now(), now(), v_org_id);
  ELSE
    -- (5) Only fill gaps; never overwrite what an existing candidate already has on file. For
    --     `source` this is what makes the column mean FIRST TOUCH — now a resolved campaign name
    --     rather than whatever text arrived. For the résumé it is a SECURITY property, not just a
    --     convention: see the header.
    UPDATE "Candidate"
       SET phone            = COALESCE(phone, p_phone),
           source           = COALESCE(source, v_source_label),
           "resumeKey"      = COALESCE("resumeKey", p_resume_key),
           -- Tied to the key, not coalesced on its own, so a new file can never end up displayed
           -- under the previous file's name.
           "resumeFileName" = CASE WHEN "resumeKey" IS NULL THEN p_resume_name
                                   ELSE "resumeFileName" END,
           "updatedAt"      = now()
     WHERE id = v_candidate_id;

    -- M7: an attached file is what THIS application carries, whatever the profile keeps.
    IF p_resume_key IS NOT NULL THEN
      v_resume_key  := p_resume_key;
      v_resume_name := p_resume_name;
    END IF;
  END IF;

  v_app_id := gen_random_uuid()::text;
  INSERT INTO "Application" (id, stage, "appliedAt", "createdAt", "updatedAt",
                             source, "campaignId",
                             -- ⇩ M6: frozen copies of what was submitted.
                             "employmentSnapshot", "educationSnapshot",
                             -- ⇩ M7: and the CV it was submitted with.
                             "resumeKey", "resumeFileName",
                             "orgId", "jobId", "candidateId")
  VALUES (v_app_id, 'APPLIED', now(), now(), now(),
          v_source_label, v_campaign_id,
          p_employment, p_education,
          v_resume_key, v_resume_name,
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

  -- ▼ M6: the PROFILE and the CONSENT record.
  --
  -- Submitting REPLACES the profile with what was just submitted — that is what "profile master,
  -- snapshot at submit" means in practice: one form, two destinations. The application already has
  -- its frozen copy above, so rewriting the profile cannot disturb anything under review.
  --
  -- Delete-then-insert rather than a diff: the form posts the whole history every time, so there is
  -- no partial update to reconcile, and matching rows up by identity would invent an editing model
  -- the UI does not have.
  IF p_employment IS NOT NULL THEN
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
    FROM jsonb_array_elements(p_employment) WITH ORDINALITY AS t(e, ord);
  END IF;

  IF p_education IS NOT NULL THEN
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
    FROM jsonb_array_elements(p_education) WITH ORDINALITY AS t(e, ord);
  END IF;

  -- Consent is recorded against the APPLICATION, not the person: it attests to this submission
  -- under a named policy version. NULL means the caller did not collect it (the ATS careers page,
  -- which predates the consent flow) — recording a consent nobody gave would be worse than none.
  IF p_consent_version IS NOT NULL THEN
    INSERT INTO "ApplicationConsent" (id, "policyVersion", "acceptedAt", "applicationId", "jobId")
    VALUES (gen_random_uuid()::text, p_consent_version, now(), v_app_id, p_job_id);
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
  IF p_answers IS NOT NULL THEN
    INSERT INTO "ApplicationAnswer" (id, "promptSnapshot", value, "createdAt",
                                     "applicationId", "questionId", "jobId")
    SELECT gen_random_uuid()::text, q.prompt, btrim(a->>'value'), now(),
           v_app_id, q.id, p_job_id
    FROM jsonb_array_elements(p_answers) a
    JOIN "JobQuestion" q
      ON q.id = a->>'questionId'
     AND q."jobId" = p_job_id
     AND q."archivedAt" IS NULL
    WHERE btrim(COALESCE(a->>'value', '')) <> '';
  END IF;
  -- ▲ END M6b

  RETURN QUERY SELECT 'OK'::text, v_app_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE APPLICANT'S OWN WRITES.
--
-- ⚠️ THE RLS-JOIN TRAP HAS A WRITE FORM, AND IT IS QUIETER THAN THE READ FORM. A bare
-- `prisma.candidate.update()` from the portal does not error and does not warn: "Candidate" is
-- governed by app_can_see_candidate ("are you STAFF who may see this person"), the portal's
-- connection carries no session variables at all, so the UPDATE matches zero rows and reports
-- success. A read at least comes back visibly empty; a write looks like it worked.
--
-- THE RULE, now covering both directions: in the candidate portal, ANY statement touching
-- "Candidate" or "Application" goes through a SECURITY DEFINER doorway scoped by account id.
--
-- All three below carry the same three guards as every other applicant doorway — the account
-- exists, it is not closed, and the candidate is not erased. That last pair is load-bearing rather
-- than defensive: sessions here are JWTs, so nothing is looked up per request and the data layer is
-- the ONLY place a closed account can actually be revoked.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- Save the profile: identity, contact, and the two histories, in one statement so a half-saved
-- profile is not a state that exists.
--
-- ⚠️ EMAIL IS ABSENT FROM THE SIGNATURE ON PURPOSE. It is the login identity (app_issue_candidate_
-- login resolves an account by candidate.email) and the dedupe key (@@unique([orgId, email])), so an
-- unverified change would be both an account-takeover surface and a way to collide with another
-- candidate's row. Changing it is a conversation with a recruiter, not a form field.
--
-- ⚠️ THE NAME IS EDITABLE AND THIS DOES CHANGE WHAT A RECRUITER SEES ON A LIVE APPLICATION — the
-- deliberate opposite of the résumé decision above. People legitimately change their name, and an
-- HRIS that cannot record that causes real harm. There is a compliance interest in freezing the
-- DOCUMENT someone was evaluated on; there is none in freezing the NAME they were evaluated under.
--
-- ⚠️ It does NOT touch Application.employmentSnapshot / educationSnapshot. That is the whole point of
-- M6's master-plus-snapshot split, and there is a test that fails if this changes.
CREATE OR REPLACE FUNCTION app_applicant_save_profile(
  p_account_id  text,
  p_first_name  text,
  p_last_name   text,
  p_phone       text,
  p_employment  jsonb DEFAULT NULL,
  p_education   jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_id text;
BEGIN
  SELECT c.id INTO v_candidate_id
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL;

  -- One answer for "no such account", "closed" and "erased". The caller is the account holder, so
  -- there is nothing to probe here — but there is nothing useful to tell them either, and three
  -- codes would invite three messages for one situation: this account can no longer be used.
  IF v_candidate_id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  UPDATE "Candidate"
     SET "firstName" = btrim(p_first_name),
         "lastName"  = btrim(p_last_name),
         phone       = NULLIF(btrim(COALESCE(p_phone, '')), ''),
         "updatedAt" = now()
   WHERE id = v_candidate_id;

  -- Delete-then-insert, identical to app_submit_application: the form posts the whole history every
  -- time, so there is no partial update to reconcile. A NULL argument means "not submitted" and
  -- leaves that history alone; an empty ARRAY means "I have none", and clears it.
  IF p_employment IS NOT NULL THEN
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
    FROM jsonb_array_elements(p_employment) WITH ORDINALITY AS t(e, ord);
  END IF;

  IF p_education IS NOT NULL THEN
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
    FROM jsonb_array_elements(p_education) WITH ORDINALITY AS t(e, ord);
  END IF;

  RETURN 'OK';
END;
$$;

-- Replace (or remove, with p_key NULL) the CV on the applicant's profile.
--
-- ⚠️ RETURNS THE SUPERSEDED KEY ONLY WHEN NOTHING STILL PINS IT. This is the invariant from the
-- header made operational. After the swap the old key is either:
--   · still referenced by an Application — in which case the file must SURVIVE, because that
--     application was submitted with it and a recruiter reading it must still see it; or
--   · referenced by nothing — a CV uploaded here and replaced before any application pinned it,
--     which is the one genuinely orphanable case, so it is handed back for deletion.
-- Getting this backwards in either direction is a real failure: delete too eagerly and an
-- application under review loses its CV; never delete and erasure cannot reach the file.
CREATE OR REPLACE FUNCTION app_applicant_set_resume(
  p_account_id text,
  p_key        text,
  p_name       text
)
RETURNS TABLE (result text, superseded_key text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_id text;
  v_old_key      text;
  v_orphan       text;
BEGIN
  SELECT c.id, c."resumeKey" INTO v_candidate_id, v_old_key
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL;

  IF v_candidate_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE "Candidate"
     SET "resumeKey"      = p_key,
         "resumeFileName" = CASE WHEN p_key IS NULL THEN NULL ELSE p_name END,
         "updatedAt"      = now()
   WHERE id = v_candidate_id;

  IF v_old_key IS NOT NULL
     AND v_old_key IS DISTINCT FROM p_key
     AND NOT EXISTS (
       SELECT 1 FROM "Application" a
       WHERE a."candidateId" = v_candidate_id AND a."resumeKey" = v_old_key
     )
  THEN
    v_orphan := v_old_key;
  END IF;

  RETURN QUERY SELECT 'OK'::text, v_orphan;
END;
$$;

-- The CV currently on the applicant's profile, for the /portal download route and the editor's
-- "on file" line. A separate function rather than another column on app_applicant_person: adding to
-- a RETURNS TABLE is a return-type change requiring DROP/CREATE, and that function sits on the
-- PUBLIC apply-form prefill path — not worth the blast radius for one column.
CREATE OR REPLACE FUNCTION app_applicant_resume(p_account_id text)
RETURNS TABLE (resume_key text, resume_file_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c."resumeKey", c."resumeFileName"
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
$$;

GRANT EXECUTE ON FUNCTION app_applicant_save_profile(text, text, text, text, jsonb, jsonb) TO hris_app;
GRANT EXECUTE ON FUNCTION app_applicant_set_resume(text, text, text)                        TO hris_app;
GRANT EXECUTE ON FUNCTION app_applicant_resume(text)                                        TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_erase_candidate — REPLACED so the sweep reaches every résumé, not just the current one.
--
-- ⚠️ DROP/CREATE, NOT CREATE OR REPLACE: the return type changes from a single `resume_key text` to
-- `resume_keys text[]`, and Postgres refuses to replace a function whose output columns differ. The
-- GRANT goes with the dropped function, so it is re-issued below.
--
-- WHY AN ARRAY: with the résumé pinned per application, one person can now legitimately have several
-- files — the CV on their profile plus whichever ones earlier applications still reference. Erasure
-- must destroy all of them, and it is the only thing that ever will, so returning just the current
-- key would silently leave every superseded CV of an erased person sitting in object storage.
--
-- Reproduced from the LIVE definition (pg_get_functiondef), not retyped: doing it from memory once
-- lost ScorecardRating.comment, Offer.outOfBandReason and ErasureRequest.decisionNote. The only
-- changes are the return type, the key collection, and the marked M7 block.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DROP FUNCTION app_erase_candidate(text, text);

CREATE FUNCTION app_erase_candidate(p_candidate_id text, p_note text DEFAULT NULL::text)
 RETURNS TABLE(result text, resume_keys text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org         text := current_setting('app.current_org_id', true);
  v_actor       text := NULLIF(current_setting('app.current_employee_id', true), '');
  v_candidate   record;
  v_resume_keys text[];
BEGIN
  IF NOT app_can_manage_erasure() THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text[];
    RETURN;
  END IF;

  SELECT c.id, c."resumeKey", c."anonymisedAt" INTO v_candidate
  FROM "Candidate" c
  WHERE c.id = p_candidate_id AND c."orgId" = v_org;

  IF v_candidate.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text[];
    RETURN;
  END IF;

  IF v_candidate."anonymisedAt" IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_ERASED'::text, NULL::text[];
    RETURN;
  END IF;

  -- The retention rule wins over the erasure right.
  IF EXISTS (
    SELECT 1 FROM "Application" a
    WHERE a."candidateId" = p_candidate_id AND a."hiredEmployeeId" IS NOT NULL
  ) THEN
    RETURN QUERY SELECT 'HIRED'::text, NULL::text[];
    RETURN;
  END IF;

  -- ▼ CHANGED IN M7 — every file this person has, gathered BEFORE the columns holding them are
  -- nulled. DISTINCT because the profile CV and an application's pinned key are usually the SAME
  -- blob (the pin shares the file rather than copying it), and asking storage to delete one key
  -- twice would turn a success into a spurious error the second time.
  SELECT array_agg(DISTINCT k) INTO v_resume_keys
  FROM (
    SELECT c."resumeKey" AS k FROM "Candidate" c
     WHERE c.id = p_candidate_id AND c."resumeKey" IS NOT NULL
    UNION
    SELECT a."resumeKey" FROM "Application" a
     WHERE a."candidateId" = p_candidate_id AND a."resumeKey" IS NOT NULL
  ) s;
  -- ▲ END M7 change

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

  -- ▼ M6: the PROFILE and the submitted SNAPSHOTS.
  --
  -- DELETED, not blanked. Everywhere else this function keeps the PROCESS and destroys the identity
  -- — stages, ratings, dates and EEO answers all survive because they are facts about what happened.
  -- An employment history is not a fact about our process at all: it is the person, and it names
  -- third parties (their employers) who never applied to us.
  DELETE FROM "CandidateEmployment" WHERE "candidateId" = p_candidate_id;
  DELETE FROM "CandidateEducation"  WHERE "candidateId" = p_candidate_id;

  -- ▼ M6b: answers to the req's screening questions. DELETED for the same reason as the employment
  -- rows — they are the person's own words. An emptied row recording "they answered something"
  -- preserves nothing, and promptSnapshot alone proves nothing either.
  DELETE FROM "ApplicationAnswer"
   WHERE "applicationId" IN (SELECT id FROM "Application" WHERE "candidateId" = p_candidate_id);
  -- ▲ END M6b

  UPDATE "Application"
     SET "employmentSnapshot" = NULL, "educationSnapshot" = NULL, "updatedAt" = now()
   WHERE "candidateId" = p_candidate_id
     AND ("employmentSnapshot" IS NOT NULL OR "educationSnapshot" IS NOT NULL);

  -- ▼ CHANGED IN M7 — the pinned résumé. A separate statement rather than folding these two columns
  -- into the snapshot UPDATE above: that one is filtered on the snapshots being non-null, and an
  -- application can carry a CV with no history attached.
  UPDATE "Application"
     SET "resumeKey" = NULL, "resumeFileName" = NULL, "updatedAt" = now()
   WHERE "candidateId" = p_candidate_id
     AND ("resumeKey" IS NOT NULL OR "resumeFileName" IS NOT NULL);
  -- ▲ END M7 change

  -- ⚠️ "ApplicationConsent" IS DELIBERATELY UNTOUCHED. It holds a policy version, a timestamp and a
  -- link — no name, no email, no IP — so there is no personal data in it to erase, and it is the
  -- evidence that the processing we DID do was lawful. Deleting it would destroy the record and
  -- protect nobody.
  -- ▲ END M6
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

  RETURN QUERY SELECT 'OK'::text, v_resume_keys;
END;
$$;

GRANT EXECUTE ON FUNCTION app_erase_candidate(text, text) TO hris_app;
