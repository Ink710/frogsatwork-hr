import "server-only";
import { getSubtreeIds } from "@hris/auth";
import { canApproveForEmployee } from "@hris/workable-hours";

// Whether `viewer` may act on an item belonging to `subjectId`, evaluated inside a withViewer tx.
// Managers need their subtree (a SECURITY DEFINER walk); HR doesn't. Shared by the leave + timesheet
// decision actions so the approval rule lives in exactly one place.
export async function viewerCanApprove(viewer, subjectId, tx) {
  const subtreeIds = viewer.role === "MANAGER" ? await getSubtreeIds(viewer.employeeId, tx) : undefined;
  return canApproveForEmployee(viewer, subjectId, { subtreeIds });
}
