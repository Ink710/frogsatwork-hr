import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { getMyApplications } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};

// Give a candidate an account the way the real flow does, and hand back its id.
//
// ⚠️ Resolve the account via the candidate_id the DOORWAY returns, never by joining "Candidate" —
// that table is under RLS and this connection has no session variables, so a join filter matches
// nothing. (Written the wrong way first, and every test in this file failed identically.)
async function accountFor(email) {
  const [issued] = await prisma.$queryRaw`
    SELECT result, candidate_id
    FROM app_issue_candidate_login(${email}, ${`h-${email}`}, (now() + interval '30 min')::timestamp(3))`;
  if (issued?.result !== "OK") return null;
  const row = await prisma.candidateAccount.findUnique({
    where: { candidateId: issued.candidate_id },
    select: { id: true },
  });
  return row?.id ?? null;
}

beforeEach(async () => {
  await resetDb();
});

describe("an applicant sees their own applications and nobody else's", () => {
  it("returns only the signed-in applicant's applications", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    const owen = await accountFor("owen.zhang@example.com");

    const norasApps = await getMyApplications(nora);
    const owensApps = await getMyApplications(owen);

    expect(norasApps.map((a) => a.jobTitle)).toEqual(["Senior Backend Engineer"]);
    // Owen applied twice — he sees both, newest first.
    expect(owensApps.map((a) => a.jobTitle)).toEqual(["Senior Backend Engineer", "Product Designer"]);
  });

  it("returns nothing for an unknown account id", async () => {
    expect(await getMyApplications("not-a-real-account")).toEqual([]);
  });

  it("returns nothing when there is no session at all", async () => {
    expect(await getMyApplications(null)).toEqual([]);
    expect(await getMyApplications(undefined)).toEqual([]);
  });
});

describe("revocation happens at the DATA layer, because sessions are stateless", () => {
  it("a CLOSED account sees nothing, even holding a valid account id", async () => {
    // ⚠️ THE POINT OF THIS TEST. Sessions are JWTs — nothing is looked up per request — so closing
    // an account on hire cannot reach a cookie that was already issued. If the doorway did not
    // re-check closedAt, a hired person would keep reading their interview history from a public
    // site until their cookie expired. `account` here stands in for exactly that live session.
    const account = await accountFor("owen.zhang@example.com");
    expect(await getMyApplications(account)).toHaveLength(2);

    await prisma.$executeRaw`SELECT app_close_candidate_account('cand-owen')`;

    expect(await getMyApplications(account)).toEqual([]);
  });

  it("an ERASED candidate sees nothing", async () => {
    const account = await accountFor("mei.tanaka@example.com");
    expect(await getMyApplications(account)).toHaveLength(1);

    await withViewer(ANA, (tx) => tx.$queryRaw`SELECT * FROM app_erase_candidate('cand-mei', 'test')`);

    expect(await getMyApplications(account)).toEqual([]);
  });
});

describe("what the projection does and does not carry", () => {
  it("never exposes the raw stage — only a mapped i18n key", async () => {
    const account = await accountFor("owen.zhang@example.com");
    const [backend, design] = await getMyApplications(account);

    expect(backend.statusKey).toBe("SCREEN");
    expect(design.statusKey).toBe("REJECTED");
    // The mapping is 1:1 by design, so the KEY equals the stage name. What matters is that no
    // property carries a stage the mapper didn't vet — and that the internal fields are absent.
    for (const app of [backend, design]) {
      expect(app).not.toHaveProperty("stage");
      expect(app).not.toHaveProperty("rejectionCategory");
      expect(app).not.toHaveProperty("rejectionReason");
    }
  });

  it("carries NO internal note, round name or actor anywhere in the payload", async () => {
    // The seed puts a real note on Owen's rejection ("Strong portfolio, but we went with a more
    // senior profile.") and a round name on Mei's advance. Serialise the whole result and prove
    // neither is in it — grepping the DATA, not dictionary keys, because the i18n false positive
    // has bitten this project three times.
    const account = await accountFor("owen.zhang@example.com");
    const payload = JSON.stringify(await getMyApplications(account));

    expect(payload).not.toContain("Strong portfolio");
    expect(payload).not.toContain("more senior profile");
    expect(payload).not.toContain("System Design");
    expect(payload).not.toContain("Technical Screen");
    expect(payload).not.toContain("actorId");
  });

  it("attaches the closing message to a rejection and NOT to a withdrawal", async () => {
    const account = await accountFor("owen.zhang@example.com");
    const design = (await getMyApplications(account)).find((a) => a.jobTitle === "Product Designer");
    expect(design.closingMessage).toBe(true);

    await withViewer(ANA, (tx) => tx.$executeRaw`UPDATE "Application" SET stage='WITHDRAWN' WHERE id='app-owen-pd'`);
    const withdrawn = (await getMyApplications(account)).find((a) => a.jobTitle === "Product Designer");
    expect(withdrawn.statusKey).toBe("WITHDRAWN");
    expect(withdrawn.closingMessage).toBe(false); // their own action — the boilerplate would be absurd
  });
});

describe("the timeline", () => {
  it("collapses Mei's two interview-round advances into one entry", async () => {
    // Seeded: APPLIED → SCREEN → INTERVIEW (Technical Screen) → INTERVIEW (System Design).
    // Round names are never exposed, so two "Interview" rows would be unexplainable.
    const account = await accountFor("mei.tanaka@example.com");
    const [app] = await getMyApplications(account);

    expect(app.timeline.map((s) => s.key)).toEqual(["APPLIED", "SCREEN", "INTERVIEW"]);
  });

  it("dates each step from when the applicant REACHED it", async () => {
    const account = await accountFor("mei.tanaka@example.com");
    const [app] = await getMyApplications(account);
    const interview = app.timeline.find((s) => s.key === "INTERVIEW");
    // Mei entered INTERVIEW on 2026-07-30 and advanced a round on 08-04; the first is the honest date.
    expect(new Date(interview.occurredAt).toISOString().slice(0, 10)).toBe("2026-07-30");
  });
});
