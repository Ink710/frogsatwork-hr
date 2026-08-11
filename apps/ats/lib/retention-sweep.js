import "server-only";
import { SYSTEM_USER_ID } from "@hris/database";
import { withViewer } from "@hris/auth";
import { isEligibleForArchive } from "@hris/recruiting";
import { getArchiveCandidates, getRetentionDays } from "@/lib/queries";

// The retention sweep: archive candidates who have gone quiet, so the active talent pool stays the
// people a recruiter might actually contact. Lives here rather than in the route handler so it can
// be tested without an HTTP layer — the same split as time-management's lib/accrual.js.
//
// Runs as a synthetic SYSTEM viewer, exactly like runAccrualForOrg. Worth noticing what this buys:
// role SYSTEM is already listed in the candidate_visibility policy's short-circuit (added in M10),
// so the sweep needs NO new SECURITY DEFINER function and NO widened policy. An unattended job gets
// its access from the same mechanism as everyone else, which means there is one fewer bypass in the
// system than there would otherwise be.
//
// The eligibility rule itself is pure and lives in @hris/recruiting/retention — this function only
// does the I/O.
export async function runRetentionSweepForOrg(orgId, { now = new Date(), retentionDays } = {}) {
  const systemViewer = { userId: SYSTEM_USER_ID, employeeId: null, role: "SYSTEM", orgId };
  const days = retentionDays ?? (await getRetentionDays());

  return withViewer(systemViewer, async (tx) => {
    const candidates = await getArchiveCandidates(tx);

    const eligible = candidates.filter((c) => isEligibleForArchive(c, { now, retentionDays: days }).eligible);
    if (eligible.length === 0) return { orgId, retentionDays: days, scanned: candidates.length, archived: 0 };

    // `archivedAt: null` in the WHERE is what makes a re-run a no-op: the second sweep matches
    // nothing, so the timestamps from the first are never overwritten. Idempotence by predicate
    // rather than by bookkeeping.
    //
    // archivedById stays NULL — that is how the UI knows to say "archived by the retention policy"
    // rather than naming a person who never touched this record.
    const { count } = await tx.candidate.updateMany({
      where: { id: { in: eligible.map((c) => c.id) }, archivedAt: null },
      data: { archivedAt: now, archivedById: null },
    });

    return { orgId, retentionDays: days, scanned: candidates.length, archived: count };
  });
}
