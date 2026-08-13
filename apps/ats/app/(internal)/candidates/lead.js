"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { leadSchema } from "@hris/recruiting";
import { getT } from "@/lib/i18n.server";
import { viewerManagesCandidateReq } from "@/lib/queries";

// Marking a great lead (M16) — "strong candidate, wrong role, call them when the next one opens."
//
// Shaped after archive.js, which is the closest-matching action in the app: reversible, understated,
// and gated in the APP rather than the database. See viewerManagesCandidateReq for why the app-layer
// check is load-bearing here rather than decorative — RLS alone would let an interviewer mark.
//
// updateMany rather than update, for archive.js's reason: RLS makes a candidate the viewer may not
// see simply invisible, so "nothing matched" is the honest outcome rather than a crash.
async function setLead(candidateId, { markedAt, note }) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    const result = await withViewer(viewer, async (tx) => {
      if (!(await viewerManagesCandidateReq(tx, candidateId))) return { count: 0, forbidden: true };

      // A hired candidate is not a future lead — they're staff, and their record lives in
      // employee-records now. Checked here rather than left to the UI so a stale page can't do it.
      if (markedAt) {
        const hired = await tx.application.count({ where: { candidateId, stage: "HIRED" } });
        if (hired > 0) return { count: 0, hired: true };
      }

      return tx.candidate.updateMany({
        where: {
          id: candidateId,
          // Never mark an erased shell: there is nobody left to call, which is exactly why
          // app_erase_candidate clears these columns in the first place.
          anonymisedAt: null,
        },
        data: {
          leadMarkedAt: markedAt,
          leadMarkedById: markedAt ? (viewer.employeeId ?? null) : null,
          // Unmarking clears the note too — a note with no mark is orphaned text about a person,
          // which is precisely the kind of stray prose an erasure has to hunt down later.
          leadNote: markedAt ? (note ?? null) : null,
        },
      });
    });

    if (result.forbidden) return { error: t("err.leadForbidden") };
    if (result.hired) return { error: t("err.leadHired") };
    if (result.count === 0) return { error: t("err.leadNotFound") };
  } catch {
    return { error: t("err.leadFailed") };
  }

  revalidatePath("/candidates");
  revalidatePath("/candidates/leads");
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

export async function markLead(candidateId, _prevState, formData) {
  const t = await getT();
  const parsed = leadSchema.safeParse({ note: formData.get("note") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  return setLead(candidateId, { markedAt: new Date(), note: parsed.data.note ?? null });
}

export async function unmarkLead(candidateId) {
  return setLead(candidateId, { markedAt: null, note: null });
}
