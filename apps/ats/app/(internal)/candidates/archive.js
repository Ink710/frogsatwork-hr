"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { canArchiveCandidate } from "@/lib/queries";

// Archiving moves a stale-but-lawful candidate out of the ACTIVE talent pool. It is not erasure and
// it is not a delete: every field survives, every report still counts them, and restoring is one
// click. That reversibility is what lets the retention sweep do this unattended (see
// app/api/cron/archive-stale) and why the guard below is a role check rather than a DB doorway.
//
// Both actions use updateMany rather than update: RLS makes a candidate the viewer may not see
// simply invisible, so "nothing matched" is the honest outcome, not a crash.
async function setArchived(candidateId, archivedAt) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canArchiveCandidate(viewer)) return { error: t("err.archiveForbidden") };

  try {
    const result = await withViewer(viewer, (tx) =>
      tx.candidate.updateMany({
        where: {
          id: candidateId,
          // Never touch an erased shell. There is nothing left to move out of the way, and flipping
          // an archive flag on a tombstone only muddies what the UI is telling you.
          anonymisedAt: null,
        },
        data: {
          archivedAt,
          // Stamped on archive, cleared on restore — so the record always says who put them here,
          // and a null means the retention policy did it rather than a person.
          archivedById: archivedAt ? (viewer.employeeId ?? null) : null,
        },
      }),
    );
    if (result.count === 0) return { error: t("err.archiveNotFound") };
  } catch {
    return { error: t("err.archiveFailed") };
  }

  revalidatePath("/candidates");
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

export async function archiveCandidate(candidateId) {
  return setArchived(candidateId, new Date());
}

export async function restoreCandidate(candidateId) {
  return setArchived(candidateId, null);
}
