// The bridge between "who is asking" (the viewer) and Postgres RLS.
//
// RLS policies read per-request session variables. With a pooled connection you can't
// just `SET` them globally — a later request could reuse the connection. So we open a
// transaction, set them LOCAL to that transaction (`set_config(..., true)`), and run all
// the viewer's queries on that transaction's client (`tx`). When the transaction ends,
// the settings vanish with it.
import { prisma } from "@hris/database";

export async function withViewer(viewer, callback) {
  if (!viewer) throw new Error("withViewer requires a viewer");

  return prisma.$transaction(async (tx) => {
    // One round-trip sets all four. Empty string when a field is absent so
    // current_setting(..., true) yields '' (which matches nothing) rather than erroring.
    await tx.$queryRaw`SELECT
      set_config('app.current_user_id',     ${viewer.userId ?? ""},     true),
      set_config('app.current_employee_id', ${viewer.employeeId ?? ""}, true),
      set_config('app.current_role',        ${viewer.role ?? ""},       true),
      set_config('app.current_org_id',      ${viewer.orgId ?? ""},      true)`;

    return callback(tx);
  });
}
