import { prisma } from "@hris/database";

// Public liveness + keep-warm endpoint. Point an uptime monitor at it every few minutes so the
// serverless function AND the (free-tier, auto-suspending) Postgres stay warm — a visitor then
// never lands on a cold-start error. Runs a trivial query as the restricted app role: no auth,
// no RLS-scoped data, nothing sensitive returned.
//
// force-dynamic so it's never statically cached — every ping must actually touch the DB.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    // DB unreachable (e.g. mid-resume) → 503 so the monitor records it, but nothing leaks.
    return Response.json({ ok: false }, { status: 503 });
  }
}
