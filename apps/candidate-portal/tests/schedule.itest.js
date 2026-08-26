import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

const session = { current: null };
vi.mock("@/lib/auth", () => ({ getApplicant: async () => session.current }));

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { claimSlot } from "../app/portal/schedule/actions.js";
import { getMySchedulableSlots, getMyInterviews } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

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

let roundId;

/** Put both seeded applicants into the interview stage on job-be, at round 1. */
async function setUpRound() {
  const [r] = await asAna((tx) =>
    tx.interviewRound.findMany({ where: { jobId: "job-be" }, orderBy: { position: "asc" }, take: 1 }),
  );
  roundId = r.id;
  await asAna((tx) =>
    tx.application.updateMany({
      where: { id: { in: ["app-nora", "app-owen"] } },
      data: { stage: "INTERVIEW", currentRoundId: r.id },
    }),
  );
}

async function publishSlot(id, { jobId = "job-be", round = null, published = true } = {}) {
  const now = new Date();
  return asAna((tx) =>
    tx.interviewSlot.create({
      data: {
        id,
        jobId,
        roundId: round ?? roundId,
        interviewerEmployeeId: "40000000-0000-0000-0000-000000000004",
        proposedById: "30000000-0000-0000-0000-000000000008",
        startAt: new Date("2026-09-01T21:00:00.000Z"),
        endAt: new Date("2026-09-01T22:00:00.000Z"),
        timeZone: "America/Mexico_City",
        confirmedAt: now,
        publishedAt: published ? now : null,
      },
    }),
  );
}

const form = (slotId) => {
  const fd = new FormData();
  if (slotId !== undefined) fd.set("slotId", slotId);
  return fd;
};

beforeEach(async () => {
  await resetDb();
  session.current = null;
  await setUpRound();
});

describe("choosing a time", () => {
  it("books a published slot and moves it out of the picker", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    await publishSlot("s1");

    expect((await getMySchedulableSlots(account)).get("app-nora")).toHaveLength(1);
    expect(await claimSlot(undefined, form("s1"))).toEqual({ ok: true });

    // Gone from what they may choose, and present as what they have.
    expect((await getMySchedulableSlots(account)).size).toBe(0);
    expect((await getMyInterviews(account)).get("app-nora")).toHaveLength(1);
  });

  // ⚠️ THE ONCE-ONLY RULE — the requirement this milestone existed for.
  it("refuses a second time in the same round, and changes nothing", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    await publishSlot("s1");
    await publishSlot("s2");

    await claimSlot(undefined, form("s1"));
    const res = await claimSlot(undefined, form("s2"));
    expect(res.error).toBeTruthy();

    const s2 = await asAna((tx) => tx.interviewSlot.findUnique({ where: { id: "s2" } }));
    expect(s2.claimedAt).toBeNull();
    expect(s2.claimedByApplicationId).toBeNull();
  });

  it("tells the loser of a race to choose another, and the winner keeps it", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    const owen = await accountFor("owen.zhang@example.com");
    await publishSlot("s1");

    session.current = { accountId: nora };
    expect(await claimSlot(undefined, form("s1"))).toEqual({ ok: true });

    session.current = { accountId: owen };
    expect((await claimSlot(undefined, form("s1"))).error).toBeTruthy();

    const s1 = await asAna((tx) => tx.interviewSlot.findUnique({ where: { id: "s1" } }));
    expect(s1.claimedByApplicationId).toBe("app-nora");
  });
});

describe("what an applicant may not do", () => {
  // ⚠️ THE REASON app_applicant_claim_slot EXISTS. The M9 staff doorway trusts a supplied
  // application id; this path never accepts one, so a valid slot id on someone else's req matches
  // no application of theirs.
  it("cannot book a slot on a job it has no application at that round for", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };

    // ⚠️ job-pd has no seeded rounds, so make one rather than assuming — an earlier version of this
    // test read `undefined.id` and failed for a reason that had nothing to do with the rule.
    const otherRound = await asAna((tx) =>
      tx.interviewRound.create({ data: { jobId: "job-pd", name: "Other req round", position: 1 } }),
    );
    await publishSlot("other", { jobId: "job-pd", round: otherRound.id });

    expect((await claimSlot(undefined, form("other"))).error).toBeTruthy();
    const slot = await asAna((tx) => tx.interviewSlot.findUnique({ where: { id: "other" } }));
    expect(slot.claimedAt).toBeNull();
  });

  it("cannot book an unpublished slot, and never sees it offered", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    await publishSlot("draft", { published: false });

    expect((await getMySchedulableSlots(account)).size).toBe(0);
    expect((await claimSlot(undefined, form("draft"))).error).toBeTruthy();
  });

  it("refuses without a session", async () => {
    await publishSlot("s1");
    session.current = null;
    expect((await claimSlot(undefined, form("s1"))).error).toBeTruthy();
  });

  it("refuses once the account is closed", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    await publishSlot("s1");
    await prisma.candidateAccount.update({ where: { id: account }, data: { closedAt: new Date() } });

    expect((await claimSlot(undefined, form("s1"))).error).toBeTruthy();
    expect((await getMySchedulableSlots(account)).size).toBe(0);
  });

  it("refuses an empty or unknown slot id", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    expect((await claimSlot(undefined, form(""))).error).toBeTruthy();
    expect((await claimSlot(undefined, form("nope"))).error).toBeTruthy();
  });
});

describe("a cancelled booking frees them to choose again", () => {
  // Staff cancelling is the ONLY reschedule path — the once-only rule binds the candidate, not us.
  it("re-offers times after the booked slot is cancelled", async () => {
    const account = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: account };
    await publishSlot("s1");
    await publishSlot("s2");
    await claimSlot(undefined, form("s1"));
    expect((await getMySchedulableSlots(account)).size).toBe(0);

    await asAna((tx) =>
      tx.interviewSlot.update({
        where: { id: "s1" },
        data: { cancelledAt: new Date(), claimedAt: null, claimedByApplicationId: null },
      }),
    );

    expect((await getMySchedulableSlots(account)).get("app-nora")).toHaveLength(1);
    expect(await claimSlot(undefined, form("s2"))).toEqual({ ok: true });
  });
});
