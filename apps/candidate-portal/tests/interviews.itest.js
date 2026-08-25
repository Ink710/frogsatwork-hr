import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { getMyInterviews } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

// ⚠️ Resolve the account via the candidate_id the DOORWAY returns, never by joining "Candidate".
async function accountFor(email) {
  const [issued] = await prisma.$queryRaw`
    SELECT result, candidate_id
    FROM app_issue_candidate_login(${email}, ${`h-${email}`}, (now() + interval '30 min')::timestamp(3))`;
  const row = await prisma.candidateAccount.findUnique({
    where: { candidateId: issued.candidate_id },
    select: { id: true },
  });
  return row.id;
}

// Create a slot in whatever state the test needs, straight through the owner connection.
async function makeSlot({ applicationId, state, timeZone = "America/Mexico_City" }) {
  const [round] = await asAna((tx) =>
    tx.interviewRound.findMany({ where: { jobId: "job-be" }, orderBy: { position: "asc" }, take: 1 }),
  );
  const now = new Date();
  return asAna((tx) =>
    tx.interviewSlot.create({
      data: {
        jobId: "job-be",
        roundId: round.id,
        interviewerEmployeeId: "40000000-0000-0000-0000-000000000004",
        proposedById: "30000000-0000-0000-0000-000000000008",
        startAt: new Date("2026-09-01T21:00:00.000Z"),
        endAt: new Date("2026-09-01T22:00:00.000Z"),
        timeZone,
        meetingUrl: "https://meet.example/abc",
        confirmedAt: state === "PROPOSED" ? null : now,
        publishedAt: state === "PROPOSED" || state === "CONFIRMED" ? null : now,
        claimedAt: state === "CLAIMED" || state === "CANCELLED" ? now : null,
        claimedByApplicationId: state === "CLAIMED" || state === "CANCELLED" ? applicationId : null,
        cancelledAt: state === "CANCELLED" ? now : null,
      },
    }),
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("an applicant sees the interview they actually have", () => {
  it("returns a published, claimed slot with its canonical zone", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-nora", state: "CLAIMED" });

    const byApp = await getMyInterviews(account);
    const [iv] = byApp.get("app-nora") ?? [];
    expect(iv).toBeDefined();
    expect(iv.timeZone).toBe("America/Mexico_City");
    expect(iv.meetingUrl).toBe("https://meet.example/abc");
    expect(new Date(iv.startAt).toISOString()).toBe("2026-09-01T21:00:00.000Z");
    // The round NAME is returned here (unlike the timeline, which withholds it) — it is what they
    // are actually attending.
    expect(typeof iv.roundName).toBe("string");
  });

  // ⚠️ THE DISCLOSURE RULE. Nothing reaches the person a slot concerns before someone decided to
  // offer it — a proposal is an internal conversation between a recruiter and an interviewer.
  it("shows nothing for a merely PROPOSED or CONFIRMED slot", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-nora", state: "PROPOSED" });
    expect((await getMyInterviews(account)).size).toBe(0);

    await resetDb();
    const account2 = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-nora", state: "CONFIRMED" });
    expect((await getMyInterviews(account2)).size).toBe(0);
  });

  it("shows nothing once the slot is cancelled", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-nora", state: "CANCELLED" });
    expect((await getMyInterviews(account)).size).toBe(0);
  });

  it("never shows another candidate's interview", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-owen", state: "CLAIMED" });
    expect((await getMyInterviews(nora)).size).toBe(0);
  });

  it("returns nothing without a session, or for an unknown account", async () => {
    expect((await getMyInterviews(null)).size).toBe(0);
    expect((await getMyInterviews("not-a-real-account")).size).toBe(0);
  });

  // Sessions are stateless JWTs, so the data layer is the only place a closed account can be
  // revoked — the same guarantee every other applicant doorway carries.
  it("returns nothing once the account is closed", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    await makeSlot({ applicationId: "app-nora", state: "CLAIMED" });
    await prisma.candidateAccount.update({ where: { id: account }, data: { closedAt: new Date() } });
    expect((await getMyInterviews(account)).size).toBe(0);
  });
});
