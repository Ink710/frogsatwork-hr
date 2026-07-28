import { timingSafeEqual } from "node:crypto";
import { prisma } from "@hris/database";
import { runAccrualForOrg, currentPeriod } from "@/lib/accrual";

// Scheduled accrual endpoint. In production a Vercel Cron hits this monthly with the shared secret;
// there's no user session, so CRON_SECRET is the auth. Never cached — it must actually run.
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
  if (!secret || !secretsMatch(provided, `Bearer ${secret}`)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const period = currentPeriod();
  // Organization has no RLS, so a bare read lists every tenant to accrue.
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const results = [];
  for (const org of orgs) results.push(await runAccrualForOrg(org.id, period));

  return Response.json({ ok: true, period, results });
}

// Vercel Cron uses GET; POST is handy for a manual curl.
export const GET = handle;
export const POST = handle;
