import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// M13: stub ONLY the network hop, so the claim/send/mark logic and the template choice run for real.
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
import { saveScreeningWindow, moveApplication } from "../app/(internal)/jobs/actions.js";

const ORG = "10000000-0000-0000-0000-000000000001";
// Raj RECRUITERs job-be. Priya is deliberately on no hiring team — the suite's outsider persona.
const RAJ = { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG };
const PRIYA = { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG };
const ANA = { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG };

const asAna = (fn) => withViewer(ANA, fn);
const as = (v) => getViewer.mockResolvedValue(v);

function windowForm({ from = "09:00", to = "17:00", timeZone = "America/Mexico_City" } = {}) {
  const fd = new FormData();
  fd.set("screeningCallFrom", from);
  fd.set("screeningCallTo", to);
  fd.set("screeningCallTimeZone", timeZone);
  return fd;
}

// ⚠️ THE SEED NOW SHIPS A WINDOW ON job-be (it is the portal demo — Owen sits at SCREEN there), so
// "writes nothing" cannot mean "is null" unless the starting state is made explicit. Clearing it
// here is more honest than asserting against whatever the seed happens to hold, and it keeps these
// tests from silently changing meaning the next time the demo data does.
const clearWindow = (jobId) =>
  asAna((tx) =>
    tx.job.update({
      where: { id: jobId },
      data: { screeningCallFrom: null, screeningCallTo: null, screeningCallTimeZone: null },
    }),
  );

const windowOn = (jobId) =>
  asAna((tx) =>
    tx.job.findUnique({
      where: { id: jobId },
      select: { screeningCallFrom: true, screeningCallTo: true, screeningCallTimeZone: true },
    }),
  );

describe("saving a screening call window", () => {
  beforeEach(async () => {
    await resetDb();
    as(RAJ);
    await clearWindow("job-be");
  });

  // Locks the demo data itself: the portal's screening notice is only demonstrable because a
  // freshly seeded job-be carries a window, and job-pd deliberately does not.
  it("is shipped by the seed on job-be and not on job-pd", async () => {
    await resetDb();
    expect(await windowOn("job-be")).toEqual({
      screeningCallFrom: "09:00",
      screeningCallTo: "17:00",
      screeningCallTimeZone: "America/Mexico_City",
    });
    expect((await windowOn("job-pd")).screeningCallFrom).toBeNull();
  });

  it("stores all three fields together", async () => {
    expect(await saveScreeningWindow("job-be", null, windowForm())).toEqual({ ok: true });
    expect(await windowOn("job-be")).toEqual({
      screeningCallFrom: "09:00",
      screeningCallTo: "17:00",
      screeningCallTimeZone: "America/Mexico_City",
    });
  });

  // An emptied form is how a window is REMOVED. If this were rejected it could be set once and
  // never taken back.
  it("clears the window when all three fields are emptied", async () => {
    await saveScreeningWindow("job-be", null, windowForm());
    const cleared = await saveScreeningWindow(
      "job-be",
      null,
      windowForm({ from: "", to: "", timeZone: "" }),
    );
    expect(cleared).toEqual({ ok: true });
    expect(await windowOn("job-be")).toEqual({
      screeningCallFrom: null,
      screeningCallTo: null,
      screeningCallTimeZone: null,
    });
  });

  it("refuses a half-set window and writes nothing", async () => {
    const res = await saveScreeningWindow("job-be", null, windowForm({ timeZone: "" }));
    expect(res.error).toBeTruthy();
    expect((await windowOn("job-be")).screeningCallFrom).toBeNull();
  });

  it("refuses an inverted window", async () => {
    const res = await saveScreeningWindow("job-be", null, windowForm({ from: "17:00", to: "09:00" }));
    expect(res.error).toBeTruthy();
    expect((await windowOn("job-be")).screeningCallFrom).toBeNull();
  });

  it("refuses a time that is not a zero-padded 24-hour clock", async () => {
    // Padding is what makes the CHECK constraint's plain text comparison chronological.
    const res = await saveScreeningWindow("job-be", null, windowForm({ from: "9:00" }));
    expect(res.error).toBeTruthy();
    expect((await windowOn("job-be")).screeningCallFrom).toBeNull();
  });

  it("refuses someone who cannot manage the req", async () => {
    as(PRIYA);
    const res = await saveScreeningWindow("job-be", null, windowForm());
    expect(res.error).toBeTruthy();
    expect((await windowOn("job-be")).screeningCallFrom).toBeNull();

    // CONTROL: the same call succeeds for the recruiter who owns the req, so the refusal above is
    // authorization rather than a broken form.
    as(RAJ);
    expect(await saveScreeningWindow("job-be", null, windowForm())).toEqual({ ok: true });
    expect((await windowOn("job-be")).screeningCallFrom).toBe("09:00");
  });
});

describe("the window in the SCREEN email", () => {
  beforeEach(async () => {
    await resetDb();
    resetMailbox();
    as(RAJ);
    await clearWindow("job-be");
  });

  const moveToScreen = (appId) => {
    const fd = new FormData();
    fd.set("toStage", "SCREEN");
    return moveApplication("job-be", appId, null, fd);
  };

  it("names the hours and their zone when the req has a window", async () => {
    await saveScreeningWindow("job-be", null, windowForm());
    expect(await moveToScreen("app-nora")).toEqual({ ok: true });

    const [mail] = mailbox;
    expect(mail).toBeTruthy();
    expect(mail.text).toContain("09:00–17:00 (America/Mexico_City)");
    expect(mail.text).toContain("available to receive a call");
  });

  // ⚠️ THE ZONE IS A LABEL, NEVER A CONVERSION. A version that formatted the hours *in* the named
  // zone would send 02:00–10:00 here, and the candidate would miss the call.
  it("does not shift the hours into the named zone", async () => {
    await saveScreeningWindow("job-be", null, windowForm({ timeZone: "Asia/Tokyo" }));
    await moveToScreen("app-nora");
    expect(mailbox[0].text).toContain("09:00–17:00 (Asia/Tokyo)");
  });

  it("falls back to M8's copy when the req has no window", async () => {
    await moveToScreen("app-nora");
    const [mail] = mailbox;
    expect(mail.text).toContain("being reviewed by our team");
    expect(mail.text).not.toContain("available to receive a call");
  });

  // The hours answer "when will you call me". Nobody at the interview stage is asking it, and the
  // INTERVIEW template has its own scheduling copy.
  it("appears only in the SCREEN message, not in later stages", async () => {
    await saveScreeningWindow("job-be", null, windowForm());
    await moveToScreen("app-nora");
    resetMailbox();

    const fd = new FormData();
    fd.set("toStage", "INTERVIEW");
    await moveApplication("job-be", "app-nora", null, fd);
    expect(mailbox[0].text).not.toContain("available to receive a call");
  });
});
