-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- STRUCTURED REJECTION REASONS (M12)
--
-- Comes directly out of M10's erasure design. Erasure blanks `Application.rejectionReason` because
-- free text is where a person's name survives ("went with someone who knew Marcus"). That was the
-- right call, but it left the ATS unable to answer "why do people get rejected?" at all — the data
-- was destroyed along with the identity.
--
-- A CATEGORY solves that: it identifies nobody, so it survives an erasure untouched, and unlike
-- prose it aggregates. The free-text column stays for the specifics; the two are complementary,
-- and only one of them gets blanked.
--
-- Fixed and org-wide rather than per-requisition (the JobCompetency pattern): per-job values cannot
-- be compared across jobs, and cross-requisition comparison is the whole point of the field.
--
-- NULLABLE, because every application rejected before today has no category and inventing one
-- would be fabricating a decision nobody made. "Required" is enforced going forward in
-- stageTransitionSchema, where it can be a rule about NEW rejections specifically.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('SKILLS_MISMATCH', 'EXPERIENCE_LEVEL', 'COMPENSATION_EXPECTATIONS', 'STRONGER_CANDIDATE', 'CANDIDATE_WITHDREW', 'POSITION_CLOSED', 'OTHER');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "rejectionCategory" "RejectionReason";
