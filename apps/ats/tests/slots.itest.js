import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// M9: stub ONLY the network hop — the claim/mark/idempotency logic runs for real.
import { resetMailbox, mailbox } from "../../../test/mailbox.js";
vi.mock("../../../packages/notifications/src/transport.js", async () => {
  const { fakeSendMail } = await import("../../../test/mailbox.js");
  return { sendMail: fakeSendMail, DEFAULT_FROM: "FrogsAtWorkHR <no-reply@test>" };
});

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

import { getViewer, withViewer } from "@hris/auth";
import { proposeSlot, confirmSlot, publishSlot, cancelSlot, assignSlot } from "../app/(internal)/jobs/actions.js";

const ORG = "10000000-0000-0000-0000-000000000001";
// Raj RECRUITERs job-be; Diego and Tom are both INTERVIEWERs on it.
const RAJ = { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG };
const DIEGO = { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG };
const TOM = { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG };
const ANA = { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG };

const asAna = (fn) => withViewer(ANA, fn);
const as = (v) => getViewer.mockResolvedValue(v);

async function firstRoundId() {
  const [r] = await asAna((tx) =>
    tx.interviewRound.findMany({ where: { jobId: "job-be" }, orderBy: { position: "asc" }, take: 1 }),
  );
  return r.id;
}

function proposalForm(roundId, over = {}) {
  const fd = new FormData();
  const base = {
    roundId,
    interviewerEmployeeId: DIEGO.employeeId,
    startsAt: "2026-09-01T15:00",
    timeZone: "America/Mexico_City",
    durationMinutes: "60",
    meetingUrl: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

const slots = () =>
  asAna((tx) =>
    tx.interviewSlot.findMany({
      orderBy: { startAt: "asc" },
      select: {
        id: true, startAt: true, timeZone: true, confirmedAt: true, publishedAt: true,
        claimedAt: true, cancelledAt: true, claimedByApplicationId: true, interviewerEmployeeId: true,
      },
    }),
  );

beforeEach(async () => {
  await resetDb();
  resetMailbox();
});

describe("proposing a time", () => {
  it("creates a PROPOSED slot and nudges the interviewer", async () => {
    as(RAJ);
    const res = await proposeSlot("job-be", undefined, proposalForm(await firstRoundId()));
    expect(res).toEqual({ ok: true });

    const [slot] = await slots();
    expect(slot.confirmedAt).toBeNull();
    expect(slot.publishedAt).toBeNull();
    expect(slot.interviewerEmployeeId).toBe(DIEGO.employeeId);

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].subject).toContain("confirm");
  });

  // ⚠️ THE WHOLE POINT OF STORING A ZONE. 15:00 in Mexico City is 21:00 UTC — if this were parsed
  // with `new Date()` it would land on the server's zone instead, and nothing would look wrong.
  it("interprets the wall clock in the CHOSEN zone, not the server's", async () => {
    as(RAJ);
    await proposeSlot("job-be", undefined, proposalForm(await firstRoundId()));
    const [slot] = await slots();
    expect(new Date(slot.startAt).toISOString()).toBe("2026-09-01T21:00:00.000Z");
    expect(slot.timeZone).toBe("America/Mexico_City");
  });

  it("stores the same wall clock as a different instant in a different zone", async () => {
    as(RAJ);
    const roundId = await firstRoundId();
    await proposeSlot("job-be", undefined, proposalForm(roundId, { timeZone: "Europe/Madrid" }));
    const [slot] = await slots();
    expect(new Date(slot.startAt).toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("refuses a malformed proposal", async () => {
    as(RAJ);
    const res = await proposeSlot("job-be", undefined, proposalForm(await firstRoundId(), { startsAt: "" }));
    expect(res.error).toBeTruthy();
    expect(await slots()).toHaveLength(0);
  });
});

describe("confirming — the two-person rule", () => {
  async function propose() {
    as(RAJ);
    await proposeSlot("job-be", undefined, proposalForm(await firstRoundId()));
    const [slot] = await slots();
    return slot.id;
  }

  it("lets the ASSIGNED interviewer confirm", async () => {
    const id = await propose();
    as(DIEGO);
    expect(await confirmSlot("job-be", id, undefined)).toEqual({ ok: true });
    const [slot] = await slots();
    expect(slot.confirmedAt).not.toBeNull();
  });

  // ⚠️ Tom is an INTERVIEWER on the same job, so he can SEE this slot — his refusal is the confirm
  // gate doing its job, not RLS hiding the row. That distinction is why the read is asserted too.
  it("refuses a DIFFERENT interviewer on the same job", async () => {
    const id = await propose();
    as(TOM);
    const res = await confirmSlot("job-be", id, undefined);
    expect(res.error).toBeTruthy();

    const [slot] = await slots();
    expect(slot.confirmedAt).toBeNull();
    const visible = await withViewer(TOM, (tx) => tx.interviewSlot.findMany({ where: { id } }));
    expect(visible).toHaveLength(1); // he could see it; he just may not confirm it
  });

  it("refuses the recruiter who proposed it", async () => {
    const id = await propose();
    as(RAJ);
    expect((await confirmSlot("job-be", id, undefined)).error).toBeTruthy();
    expect((await slots())[0].confirmedAt).toBeNull();
  });

  it("will not publish a slot nobody confirmed", async () => {
    const id = await propose();
    as(RAJ);
    const res = await publishSlot("job-be", id, undefined);
    expect(res.error).toBeTruthy();
    expect((await slots())[0].publishedAt).toBeNull();
  });

  it("publishes once it is confirmed", async () => {
    const id = await propose();
    as(DIEGO);
    await confirmSlot("job-be", id, undefined);
    as(RAJ);
    expect(await publishSlot("job-be", id, undefined)).toEqual({ ok: true });
    expect((await slots())[0].publishedAt).not.toBeNull();
  });
});

describe("claiming — the shared pool race", () => {
  async function publishedSlot(over = {}) {
    as(RAJ);
    await proposeSlot("job-be", undefined, proposalForm(await firstRoundId(), over));
    const all = await slots();
    const slot = all[all.length - 1];
    as(DIEGO);
    await confirmSlot("job-be", slot.id, undefined);
    as(RAJ);
    await publishSlot("job-be", slot.id, undefined);
    return slot.id;
  }

  it("books a published slot for an application", async () => {
    const id = await publishedSlot();
    as(RAJ);
    expect(await assignSlot("job-be", "app-nora", undefined, formWith(id))).toEqual({ ok: true });
    const [slot] = (await slots()).filter((s) => s.id === id);
    expect(slot.claimedByApplicationId).toBe("app-nora");
  });

  // ⚠️ The reason the claim is a conditional UPDATE in a doorway. The loser is TOLD, not crashed.
  it("refuses a second claimant on the same slot", async () => {
    const id = await publishedSlot();
    as(RAJ);
    await assignSlot("job-be", "app-nora", undefined, formWith(id));
    const res = await assignSlot("job-be", "app-owen", undefined, formWith(id));
    expect(res.error).toBeTruthy();

    const [slot] = (await slots()).filter((s) => s.id === id);
    expect(slot.claimedByApplicationId).toBe("app-nora"); // the first claimant keeps it
  });

  it("refuses an unpublished slot", async () => {
    as(RAJ);
    await proposeSlot("job-be", undefined, proposalForm(await firstRoundId()));
    const [slot] = await slots();
    expect((await assignSlot("job-be", "app-nora", undefined, formWith(slot.id))).error).toBeTruthy();
  });

  it("refuses a second slot in the SAME round for one application", async () => {
    const first = await publishedSlot();
    const second = await publishedSlot({ startsAt: "2026-09-02T15:00" });
    as(RAJ);
    await assignSlot("job-be", "app-nora", undefined, formWith(first));
    const res = await assignSlot("job-be", "app-nora", undefined, formWith(second));
    expect(res.error).toBeTruthy();
    // …but somebody else may still take it.
    expect(await assignSlot("job-be", "app-owen", undefined, formWith(second))).toEqual({ ok: true });
  });

  // Cancelling must RELEASE the claim, or the unique constraint would block rebooking forever.
  it("cancelling frees the application to book again in that round", async () => {
    const first = await publishedSlot();
    const second = await publishedSlot({ startsAt: "2026-09-03T15:00" });
    as(RAJ);
    await assignSlot("job-be", "app-nora", undefined, formWith(first));
    await cancelSlot("job-be", first, undefined);

    const cancelled = (await slots()).find((s) => s.id === first);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.claimedByApplicationId).toBeNull();

    expect(await assignSlot("job-be", "app-nora", undefined, formWith(second))).toEqual({ ok: true });
  });
});

function formWith(slotId) {
  const fd = new FormData();
  fd.set("slotId", slotId);
  return fd;
}
