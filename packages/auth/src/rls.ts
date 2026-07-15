// The bridge between "who is asking" (the viewer) and Postgres RLS.
//
// RLS policies read per-request session variables. With a pooled connection you can't
// just `SET` them globally — a later request could reuse the connection. So we open a
// transaction, set them LOCAL to that transaction (`set_config(..., true)`), and run all
// the viewer's queries on that transaction's client (`tx`). When the transaction ends,
// the settings vanish with it.
import { prisma, Prisma } from "@hris/database";
import type { Viewer } from "./roles";

// Generic over T: withViewer returns exactly whatever the callback returns. Without the
// <T> the return type would collapse to `any` (or `unknown`) and every caller would lose
// its result type. `tx` is the RLS-scoped transaction client the callback runs its queries on.
export async function withViewer<T>(
  viewer: Viewer,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!viewer) throw new Error("withViewer requires a viewer");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
