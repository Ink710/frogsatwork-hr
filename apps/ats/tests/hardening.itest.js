import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG };
const RAJ = { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG };

const asAna = (fn) => withViewer(ANA, fn);

beforeEach(async () => {
  await resetDb();
});

/**
 * M14 hardening (migration 20260830120000_delete_and_doorway_hardening).
 *
 * These lock three properties that the code already respected by convention. Each was found by a
 * pre-deploy audit, and each would fail SILENTLY if a future migration re-granted or reworded it —
 * which is exactly why they are asserted rather than trusted.
 */
describe("the retention rule is a privilege, not a convention", () => {
  // ⚠️ Asserted through the RESTRICTED role, which is what production runs as. Prisma's client uses
  // DATABASE_URL (hris_app); the migrations run as the owner, who is deliberately still allowed.
  const cases = [
    ["Employee", () => asAna((tx) => tx.employee.deleteMany({ where: { id: "no-such-employee" } }))],
    ["EmployeeHistory", () => asAna((tx) => tx.employeeHistory.deleteMany({ where: { id: "nope" } }))],
    ["Candidate", () => asAna((tx) => tx.candidate.deleteMany({ where: { id: "nope" } }))],
    ["Application", () => asAna((tx) => tx.application.deleteMany({ where: { id: "nope" } }))],
  ];

  for (const [table, run] of cases) {
    it(`refuses DELETE on ${table} even for HR_ADMIN`, async () => {
      // A matching row is not needed: the privilege is checked before any row is considered, which
      // is precisely the point — there is no state in which this succeeds.
      await expect(run()).rejects.toThrow(/permission denied/i);
    });
  }

  // ⚠️ CONTROL. Without this, all four assertions above would also pass if the test role had simply
  // lost every privilege, or if withViewer were broken — a green suite proving nothing.
  it("CONTROL: a table outside the retention set still permits DELETE, and reads still work", async () => {
    await expect(
      asAna((tx) => tx.jobCompetency.deleteMany({ where: { id: "no-such-competency" } })),
    ).resolves.toEqual({ count: 0 });
    expect(await asAna((tx) => tx.employee.count())).toBeGreaterThan(0);
  });
});

describe("app_close_candidate_account checks its caller", () => {
  const close = (viewer, candidateId) =>
    withViewer(viewer, (tx) => tx.$executeRaw`SELECT app_close_candidate_account(${candidateId})`);

  const accountFor = (candidateId) =>
    prisma.candidateAccount.findFirst({ where: { candidateId }, select: { closedAt: true } });

  // ⚠️ A seeded candidate has NO CandidateAccount row — accounts are created lazily, the first time
  // someone requests a login link. Asserting against a null row is how the first draft of this file
  // "failed": the guards were working, the fixture was not.
  const ensureAccount = (email) => prisma.$queryRaw`
    SELECT result FROM app_issue_candidate_login(
      ${email}, ${`h-${email}`}, (now() + interval '30 min')::timestamp(3))`;

  beforeEach(async () => {
    await ensureAccount("owen.zhang@example.com");
  });

  it("lets HR_ADMIN close an account", async () => {
    await close(ANA, "cand-owen");
    expect((await accountFor("cand-owen")).closedAt).not.toBeNull();
  });

  // A recruiter manages reqs and moves candidates through stages, but onboarding — and therefore
  // closing the applicant identity — belongs to whoever owns employee records. Mirrors app_link_hire.
  it("refuses a RECRUITER, and changes nothing", async () => {
    await expect(close(RAJ, "cand-owen")).rejects.toThrow(/not authorized/i);
    expect((await accountFor("cand-owen")).closedAt).toBeNull();
  });
});

/**
 * ⚠️ THE REGRESSION THIS FILE EXISTS FOR.
 *
 * `current_setting('app.current_role', true)` is NULL when the GUC was never set, and
 * `NULL NOT IN (...)` is NULL rather than TRUE — so an `IF ... NOT IN` guard does NOT fire and is
 * skipped entirely. Both guards refused a signed-in RECRUITER while waving through a connection
 * that had never identified itself: exactly inverted.
 *
 * This is reachable, not theoretical — every public surface in this suite (the apply flow, the
 * careers page, the portal doorways) deliberately uses a bare prisma client with no session vars.
 */
describe("the role guards fire for a caller with NO session identity", () => {
  it("app_link_hire refuses, rather than falling through to a later business check", async () => {
    // Bare `prisma` — no withViewer, so no app.current_role, like every public path.
    const [row] = await prisma.$queryRaw`
      SELECT app_link_hire('app-owen', '40000000-0000-0000-0000-000000000002') AS result`;
    // Before the fix this returned NOT_HIRED — a check that sits BELOW the role gate, proving the
    // gate had already been passed. FORBIDDEN is the gate itself answering.
    expect(row.result).toBe("FORBIDDEN");
  });

  it("app_close_candidate_account refuses", async () => {
    await expect(
      prisma.$executeRaw`SELECT app_close_candidate_account('cand-owen')`,
    ).rejects.toThrow(/not authorized/i);
  });

  // CONTROL: the same call under a real HR_ADMIN session gets PAST the role gate and is refused on
  // business grounds instead. Without this, "FORBIDDEN" above could just mean the function is broken.
  it("CONTROL: HR_ADMIN passes the gate and is stopped by the business rule instead", async () => {
    const [row] = await asAna(
      (tx) => tx.$queryRaw`
        SELECT app_link_hire('app-owen', '40000000-0000-0000-0000-000000000002') AS result`,
    );
    expect(row.result).toBe("NOT_HIRED");
  });
});
