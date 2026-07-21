import { prisma } from "@hris/database";
import { runAccrualForOrg, currentPeriod } from "@/lib/accrual";

// Scheduled accrual endpoint. In production a Vercel Cron hits this monthly with the shared secret;
// there's no user session, so CRON_SECRET is the auth. Never cached — it must actually run.
export const dynamic = "force-dynamic";

async function handle(request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  // Require a configured secret AND a matching bearer token — no secret set ⇒ locked down.
  if (!secret || provided !== `Bearer ${secret}`) {
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
