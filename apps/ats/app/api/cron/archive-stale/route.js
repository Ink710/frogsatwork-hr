import { timingSafeEqual } from "node:crypto";
import { prisma } from "@hris/database";
import { runRetentionSweepForOrg } from "@/lib/retention-sweep";

// Scheduled candidate-retention sweep. In production a Vercel Cron hits this weekly with the shared
// secret; there's no user session, so CRON_SECRET is the auth. Never cached — it must actually run.
//
// Deliberately the same shape as time-management's /api/cron/accrue, down to the constant-time
// compare: two scheduled jobs in one suite should not have two different ideas of what "authenticated
// cron request" means.
export const dynamic = "force-dynamic";

// Constant-time string compare so an attacker can't recover the secret byte-by-byte via timing.
// A length mismatch short-circuits (the length isn't the secret), which timingSafeEqual requires.
function secretsMatch(provided, expected) {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  // Require a configured secret AND a matching bearer token — no secret set ⇒ locked down.
  // Fail closed: an unconfigured deployment must not expose a bulk-mutation endpoint.
  if (!secret || !secretsMatch(provided, `Bearer ${secret}`)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // Organization has no RLS, so a bare read lists every tenant to sweep.
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const results = [];
  for (const org of orgs) results.push(await runRetentionSweepForOrg(org.id));

  return Response.json({ ok: true, results });
}

// Vercel Cron uses GET; POST is handy for a manual curl.
export const GET = handle;
export const POST = handle;
