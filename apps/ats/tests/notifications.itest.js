import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// M8: stub ONLY the network hop — the claim/mark/idempotency logic runs for real.
// Target the transport module, not the package: deliver.js imports it relatively, so mocking
// "@hris/notifications" would leave the real nodemailer in place and the mailbox silently empty.
import { resetMailbox, mailbox, mailerState } from "../../../test/mailbox.js";
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

import { prisma } from "@hris/database";
import { getViewer, withViewer } from "@hris/auth";
import { moveApplication, advanceRound } from "../app/(internal)/jobs/actions.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

const move = (toStage, extra = {}) => {
  const fd = new FormData();
  fd.set("toStage", toStage);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return moveApplication("job-be", "app-nora", undefined, fd);
};

const deliveries = () =>
  asAna((tx) =>
    tx.notificationDelivery.findMany({
      orderBy: { createdAt: "asc" },
      select: { channel: true, status: true, recipientUserId: true, applicationEventId: true },
    }),
  );

beforeEach(async () => {
  await resetDb();
  resetMailbox();
  getViewer.mockResolvedValue(ANA);
});

describe("a stage move notifies the candidate", () => {
  it("sends after the move, to the candidate, and records it as SENT", async () => {
    const res = await move("SCREEN");
    expect(res).toEqual({ ok: true });

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].to).toBe("nora.adeyemi@example.com");
    expect(mailbox[0].subject).toContain("Senior Backend Engineer");

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].channel).toBe("EMAIL");
    // NULL recipient means "the candidate on this event" — M8 writes nothing else.
    expect(rows[0].recipientUserId).toBeNull();
  });

  it("the stage change still commits when the send fails", async () => {
    // ⚠️ THE WHOLE REASON THE SEND IS POST-COMMIT. In production there is no SMTP provider, so this
    // is the NORMAL path, not an edge case: a failing mailer must never roll back a stage move.
    mailerState.failNext = true;

    const res = await move("SCREEN");
    expect(res).toEqual({ ok: true });

    const app = await asAna((tx) =>
      tx.application.findUnique({ where: { id: "app-nora" }, select: { stage: true } }),
    );
    expect(app.stage).toBe("SCREEN");

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
  });

  it("a failed delivery can be retried, a successful one cannot", async () => {
    mailerState.failNext = true;
    await move("SCREEN");
    expect(mailbox).toHaveLength(0);

    // Same event, second attempt: the FAILED row is re-claimable.
    const [event] = await asAna((tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-nora", toStage: "SCREEN" } }),
    );
    const { deliverCandidateStageEmail } = await import("@hris/notifications");
    const retry = await deliverCandidateStageEmail({
      db: prisma,
      eventId: event.id,
      stageKey: "SCREEN",
      to: "nora.adeyemi@example.com",
      firstName: "Nora",
      jobTitle: "Senior Backend Engineer",
      portalUrl: "http://localhost:3003/portal",
    });
    expect(retry.sent).toBe(true);
    expect(mailbox).toHaveLength(1);

    // Now it is SENT, so a third attempt must be refused.
    const again = await deliverCandidateStageEmail({
      db: prisma,
      eventId: event.id,
      stageKey: "SCREEN",
      to: "nora.adeyemi@example.com",
      firstName: "Nora",
      jobTitle: "Senior Backend Engineer",
      portalUrl: "http://localhost:3003/portal",
    });
    expect(again.sent).toBe(false);
    expect(again.skipped).toBe("ALREADY_SENT");
    expect(mailbox).toHaveLength(1);
  });
});

describe("what does NOT notify", () => {
  it("an interview ROUND advance sends nothing", async () => {
    await move("SCREEN");
    await move("INTERVIEW");
    resetMailbox();

    // advanceRound is a separate action writing INTERVIEW→INTERVIEW; it must stay silent, or a
    // three-round process would mail the candidate three times about the same stage.
    const res = await advanceRound("job-be", "app-nora", undefined);
    expect(res).toEqual({ ok: true });
    expect(mailbox).toHaveLength(0);
  });

  it("WITHDRAWN sends nothing", async () => {
    await move("WITHDRAWN");
    expect(mailbox).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
  });
});

describe("the rejection message", () => {
  it("never contains the internal reason or category", async () => {
    await move("REJECTED", {
      rejectionReason: "Weak on system design and rude to the receptionist",
      rejectionCategory: "SKILLS_MISMATCH",
    });

    expect(mailbox).toHaveLength(1);
    const body = `${mailbox[0].subject} ${mailbox[0].text} ${mailbox[0].html}`;
    expect(body).not.toContain("receptionist");
    expect(body).not.toContain("system design");
    expect(body).not.toContain("SKILLS_MISMATCH");
    // …and it does carry the standard courtesy wording.
    expect(mailbox[0].text).toContain("decided not to move forward");
  });
});

describe("the candidate's own language, not the sender's", () => {
  it("writes in the candidate's locale even though the recruiter's is English", async () => {
    // The i18n mock above pins the REQUEST locale to "en" — that is the recruiter's. The candidate
    // is Spanish-speaking, and this is the difference C3 exists to catch.
    await asAna((tx) =>
      tx.candidate.update({ where: { id: "cand-nora" }, data: { locale: "es" } }),
    );

    await move("SCREEN");
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].text).toContain("Hola");
    expect(mailbox[0].subject).toContain("postulación");
  });

  it("falls back to English when the candidate has no locale", async () => {
    await asAna((tx) =>
      tx.candidate.update({ where: { id: "cand-nora" }, data: { locale: null } }),
    );
    await move("SCREEN");
    expect(mailbox[0].text).toContain("Hi Nora");
  });
});

describe("an erased candidate is never written to", () => {
  it("sends nothing once the record has been anonymised", async () => {
    // Erasure scrambles the address to @anonymised.invalid; mailing it is both pointless and wrong.
    await asAna((tx) => tx.$queryRaw`SELECT result FROM app_erase_candidate('cand-nora', 'test')`);
    resetMailbox();

    await move("SCREEN");
    expect(mailbox).toHaveLength(0);
  });
});
