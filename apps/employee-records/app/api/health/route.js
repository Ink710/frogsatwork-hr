import { prisma } from "@hris/database";

// Public liveness endpoint. Runs a trivial query as the restricted app role: no auth, no
// RLS-scoped data, nothing sensitive returned.
//
// ⚠️ DO NOT POINT A FREQUENT UPTIME PINGER AT THIS. An earlier version of this comment recommended
// hitting it every ~5 minutes to keep Neon's free-tier compute from auto-suspending, so visitors
// never meet a cold start. That advice took all three demos OFFLINE.
//
// The arithmetic: Neon free allows 100 CU-hrs/month and the compute runs at 0.25 CU, so the budget
// is ~400 hours of ACTIVE compute. Pinging every 5 minutes means the database never suspends —
// ~720 hours/month of activity, or ~180 CU-hrs. The quota is gone before month end and every app
// sharing that database starts refusing connections in under a second.
//
// Cold starts and quota are the SAME DIAL. With autosuspend left alone and bursty demo traffic the
// free tier is comfortably sufficient, at the cost of a few seconds for the first visitor after an
// idle spell — a far better trade for a portfolio demo than being down. Use this endpoint for
// on-demand liveness checks, not as a heartbeat.
//
// force-dynamic so it's never statically cached — every ping must actually touch the DB.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch (e) {
    // DB unreachable → 503 so the monitor records it. The RESPONSE still says nothing (a liveness
    // probe is public; it must not describe our infrastructure to strangers) but the cause is LOGGED,
    // because a health check that can't tell you why it's unhealthy sends you hunting blind. Learned
    // the hard way during an all-apps outage: every app returned a tidy {ok:false} and the platform
    // logs held nothing, so the only readable error came from an unhandled 500 on another route.
    console.error("[health] database unreachable", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
