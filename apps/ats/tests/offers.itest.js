import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// Same harness as the other ATS integration tests: getViewer is mocked per-test to act as a persona,
// withViewer is REAL, so every assertion below is an actual round-trip through Postgres RLS.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  return { getViewer: vi.fn(), withViewer: rls.withViewer, isRecruiter: roles.isRecruiter };
});

import { getViewer, withViewer } from "@hris/auth";
import {
  setSalaryBand,
  saveOfferDraft,
  extendOffer,
  recordOfferOutcome,
  reviseOffer,
} from "../app/(internal)/jobs/offers.js";
import { moveApplication, advanceRound } from "../app/(internal)/jobs/actions.js";
import { getOfferPanel, getSalaryBand, getPublishedJob } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const fd = (o) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(o)) f.set(k, val);
  return f;
};

// Read straight through RLS as a given persona — the "what can this role actually SELECT?" probe.
const offerRows = (v) => withViewer(v, (tx) => tx.offer.findMany());
const bandRows = (v) => withViewer(v, (tx) => tx.salaryBand.findMany());
const currentOffer = () =>
  withViewer(V.raj, (tx) =>
    tx.offer.findFirst({ where: { applicationId: "app-luis" }, orderBy: { version: "desc" } }),
  );

/**
 * Get Mei to the OFFER stage so an offer can be written for her.
 *
 * ⚠️ The advanceRound is REQUIRED, not incidental. Mei is seeded mid-INTERVIEW at round 2 of 3, and
 * Polish B's `hasRemainingRounds` guard refuses INTERVIEW→OFFER while rounds remain — so a bare
 * moveApplication here fails and every assertion after it becomes meaningless. Walk her to the last
 * round first. (The M12 lesson: check the transition rules before writing a test that leaves a stage.)
 */
async function moveMeiToOffer() {
  await advanceRound("job-be", "app-mei", undefined); // System Design → Team Interview (the last)
  const moved = await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "OFFER" }));
  expect(moved.ok).toBe(true);
}

beforeEach(async () => {
  await resetDb();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The access boundary. This is the milestone's whole reason for existing, so it is tested first
// and at the DATABASE level, not through the UI's willingness to render a card.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("who can see compensation", () => {
  it("lets the recruiter and the hiring manager read the band and the offer", async () => {
    expect(await bandRows(V.raj)).toHaveLength(1);
    expect(await offerRows(V.raj)).toHaveLength(1);
    expect(await bandRows(V.marcus)).toHaveLength(1);
    expect(await offerRows(V.marcus)).toHaveLength(1);
  });

  it("shows an INTERVIEWER the job and the application but NOT one salary row", async () => {
    // The distinction matters: Diego is a legitimate member of this hiring team. He is not being
    // hidden from the candidate — only from the money.
    const seen = await withViewer(V.diego, async (tx) => ({
      jobs: await tx.job.count({ where: { id: "job-be" } }),
      applications: await tx.application.count({ where: { id: "app-luis" } }),
      bands: await tx.salaryBand.count(),
      offers: await tx.offer.count(),
    }));
    expect(seen).toEqual({ jobs: 1, applications: 1, bands: 0, offers: 0 });
  });

  it("shows an HR_GENERALIST the req but not the band or the offer", async () => {
    // Bianca is not in app_can_manage_job. She reaches the accepted figures only through
    // app_offer_for_hire, at the moment she creates the employee — see hire.itest.js.
    const jobs = await withViewer(V.bianca, (tx) => tx.job.count({ where: { id: "job-be" } }));
    expect(jobs).toBe(1);
    expect(await bandRows(V.bianca)).toHaveLength(0);
    expect(await offerRows(V.bianca)).toHaveLength(0);
  });

  it("shows an outsider nothing at all", async () => {
    expect(await bandRows(V.priya)).toHaveLength(0);
    expect(await offerRows(V.priya)).toHaveLength(0);
  });

  it("returns NULL from getOfferPanel for anyone who can't manage — no empty shell to inspect", async () => {
    as(V.diego);
    expect(await getOfferPanel("job-be", "app-luis")).toBeNull();
    as(V.priya);
    expect(await getOfferPanel("job-be", "app-luis")).toBeNull();
    as(V.raj);
    expect(await getOfferPanel("job-be", "app-luis")).not.toBeNull();
  });

  it("refuses an interviewer's write, and RLS refuses it too", async () => {
    as(V.diego);
    const res = await saveOfferDraft("job-be", "app-luis", undefined, fd({ salary: "999999" }));
    expect(res.error).toBeTruthy();
    // Nothing changed for someone who CAN see it.
    expect((await currentOffer()).salary.toString()).toBe("150000");
  });

  it("refuses an interviewer's attempt to set a band", async () => {
    as(V.diego);
    const res = await setSalaryBand(
      "job-be",
      undefined,
      fd({ salaryMin: "1", salaryMax: "2", currency: "USD", payBasis: "PER_YEAR" }),
    );
    expect(res.error).toBeTruthy();
    const band = await withViewer(V.raj, (tx) => tx.salaryBand.findFirst({ where: { jobId: "job-be" } }));
    expect(band.salaryMin.toString()).toBe("120000");
  });

  it("never lets an offer be DELETED, even by the recruiter who wrote it", async () => {
    // Superseding is how an offer goes away. The revoke is what makes the version history a record
    // rather than a convention.
    await expect(
      withViewer(V.raj, (tx) => tx.offer.deleteMany({ where: { applicationId: "app-luis" } })),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The band
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the salary band", () => {
  it("sets a band on a req that had none, and updates one that had", async () => {
    as(V.raj);
    const created = await setSalaryBand(
      "job-pd",
      undefined,
      fd({ salaryMin: "90000", salaryMax: "110000", currency: "usd", payBasis: "PER_YEAR" }),
    );
    expect(created.ok).toBe(true);
    expect(await getSalaryBand("job-pd")).toMatchObject({
      salaryMin: "90000",
      salaryMax: "110000",
      currency: "USD", // upper-cased by the shared schema
      postPublicly: false, // never the default
    });

    await setSalaryBand(
      "job-pd",
      undefined,
      fd({ salaryMin: "95000", salaryMax: "115000", currency: "USD", payBasis: "PER_YEAR" }),
    );
    expect((await getSalaryBand("job-pd")).salaryMin).toBe("95000");
  });

  it("refuses an inverted range", async () => {
    as(V.raj);
    const res = await setSalaryBand(
      "job-be",
      undefined,
      fd({ salaryMin: "200000", salaryMax: "100000", currency: "USD", payBasis: "PER_YEAR" }),
    );
    expect(res.error).toBeTruthy();
  });

  it("posts the range publicly only when asked, and the public function decides — not the query", async () => {
    // job-be is seeded with postPublicly: true. (The raw ::text cast keeps the scale — "120000.00" —
    // where Prisma's toString() drops it; formatMoney renders both identically.)
    expect(await getPublishedJob("job-be")).toMatchObject({
      salaryMin: "120000.00",
      salaryMax: "160000.00",
      currency: "USD",
    });
    // job-pd has no band at all: NULLs, indistinguishable from a band that simply isn't posted.
    expect(await getPublishedJob("job-pd")).toMatchObject({ salaryMin: null, salaryMax: null });

    as(V.raj);
    await setSalaryBand(
      "job-be",
      undefined,
      fd({ salaryMin: "120000", salaryMax: "160000", currency: "USD", payBasis: "PER_YEAR" }), // no postPublicly
    );
    expect(await getPublishedJob("job-be")).toMatchObject({ salaryMin: null, salaryMax: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The offer lifecycle
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the offer lifecycle", () => {
  it("walks draft → extended → accepted, locking the figures on the way", async () => {
    as(V.raj);
    // Start from a fresh draft on a different application that we move to OFFER first.
    const panel0 = await getOfferPanel("job-be", "app-luis");
    const offerId = panel0.current.id;

    // The seeded offer is already EXTENDED, so editing it must be refused.
    const locked = await saveOfferDraft("job-be", "app-luis", undefined, fd({ salary: "155000" }));
    expect(locked.error).toBeTruthy();
    expect((await currentOffer()).salary.toString()).toBe("150000");

    const accepted = await recordOfferOutcome("job-be", "app-luis", offerId, undefined, fd({ outcome: "ACCEPTED" }));
    expect(accepted.ok).toBe(true);
    expect((await currentOffer()).status).toBe("ACCEPTED");
  });

  it("refuses a status move the lifecycle forbids", async () => {
    as(V.raj);
    const { current } = await getOfferPanel("job-be", "app-luis");
    // EXTENDED → EXTENDED is not a transition; nor is jumping to SUPERSEDED by hand.
    const res = await recordOfferOutcome("job-be", "app-luis", current.id, undefined, fd({ outcome: "SUPERSEDED" }));
    expect(res.error).toBeTruthy();
    expect((await currentOffer()).status).toBe("EXTENDED");
  });

  it("creates a first offer where there is none, snapshotting the band", async () => {
    as(V.raj);
    await moveMeiToOffer();

    const res = await saveOfferDraft(
      "job-be",
      "app-mei",
      undefined,
      fd({ salary: "140000", currency: "USD", payBasis: "PER_YEAR", startDate: "2026-10-01" }),
    );
    expect(res.ok).toBe(true);

    const panel = await getOfferPanel("job-be", "app-mei");
    expect(panel.current).toMatchObject({ version: 1, status: "DRAFT", salary: "140000" });
    // Classified against the band as it stood when written — the snapshot, not today's band.
    expect(panel.current.classification).toEqual({ position: "IN_BAND", compaRatio: 1 });
    expect(panel.current.startDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("supersedes rather than overwrites when an offer is revised", async () => {
    as(V.raj);
    const { current } = await getOfferPanel("job-be", "app-luis");
    const res = await reviseOffer("job-be", "app-luis", current.id, undefined);
    expect(res.ok).toBe(true);

    const panel = await getOfferPanel("job-be", "app-luis");
    expect(panel.offers).toHaveLength(2);
    expect(panel.current).toMatchObject({ version: 2, status: "DRAFT" });
    // The original survives intact — this is the whole point of versioning rather than editing.
    const v1 = panel.offers.find((o) => o.version === 1);
    expect(v1).toMatchObject({ status: "SUPERSEDED", salary: "150000" });

    // And the new draft IS editable.
    const edited = await saveOfferDraft("job-be", "app-luis", undefined, fd({ salary: "158000" }));
    expect(edited.ok).toBe(true);
    expect((await getOfferPanel("job-be", "app-luis")).current.salary).toBe("158000");
  });

  it("refuses to revise a DRAFT (edit it) or an ACCEPTED offer (it's an agreement)", async () => {
    as(V.raj);
    const { current } = await getOfferPanel("job-be", "app-luis");
    await recordOfferOutcome("job-be", "app-luis", current.id, undefined, fd({ outcome: "ACCEPTED" }));
    const res = await reviseOffer("job-be", "app-luis", current.id, undefined);
    expect(res.error).toBeTruthy();
    expect((await currentOffer()).status).toBe("ACCEPTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The out-of-band control
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("out-of-band offers", () => {
  beforeEach(async () => {
    as(V.raj);
    await moveMeiToOffer();
  });

  it("refuses an offer outside the band with no justification", async () => {
    const res = await saveOfferDraft("job-be", "app-mei", undefined, fd({ salary: "185000" }));
    expect(res.error).toMatch(/outside the approved band/i);
    expect(await withViewer(V.raj, (tx) => tx.offer.count({ where: { applicationId: "app-mei" } }))).toBe(0);
  });

  it("accepts it once justified, and records the reason", async () => {
    const res = await saveOfferDraft(
      "job-be",
      "app-mei",
      undefined,
      fd({ salary: "185000", outOfBandReason: "Counter-offer; approved by the VP." }),
    );
    expect(res.ok).toBe(true);
    const panel = await getOfferPanel("job-be", "app-mei");
    expect(panel.current.classification.position).toBe("ABOVE");
    expect(panel.current.outOfBandReason).toMatch(/approved by the VP/);
  });

  it("IGNORES a band posted in the form — the server reads the real one", async () => {
    // Without this, anyone could widen the band in the payload and skip the control entirely.
    const res = await saveOfferDraft(
      "job-be",
      "app-mei",
      undefined,
      fd({ salary: "185000", bandMin: "1", bandMax: "999999" }),
    );
    expect(res.error).toMatch(/outside the approved band/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The stage gate: write at OFFER, read forever after
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the OFFER-stage gate", () => {
  it("refuses to write an offer for someone who isn't at the offer stage", async () => {
    as(V.raj);
    const res = await saveOfferDraft("job-be", "app-nora", undefined, fd({ salary: "130000" })); // APPLIED
    expect(res.error).toMatch(/offer stage/i);
  });

  it("KEEPS the figures readable once the candidate is hired", async () => {
    // The M15 call, applied here: gating reads too would hide the agreed salary at exactly the
    // moment HR needs it to onboard the person, and erase the record of what was agreed.
    as(V.raj);
    const { current } = await getOfferPanel("job-be", "app-luis");
    await recordOfferOutcome("job-be", "app-luis", current.id, undefined, fd({ outcome: "ACCEPTED" }));
    await moveApplication("job-be", "app-luis", undefined, fd({ toStage: "HIRED" }));

    const panel = await getOfferPanel("job-be", "app-luis");
    expect(panel.stage).toBe("HIRED");
    expect(panel.canWrite).toBe(false);
    expect(panel.current).toMatchObject({ status: "ACCEPTED", salary: "150000" });
  });

  it("keeps them readable on a rejected application too", async () => {
    as(V.raj);
    await moveApplication(
      "job-be",
      "app-luis",
      undefined,
      fd({ toStage: "REJECTED", rejectionCategory: "COMPENSATION_EXPECTATIONS" }),
    );
    const panel = await getOfferPanel("job-be", "app-luis");
    expect(panel.canWrite).toBe(false);
    expect(panel.current.salary).toBe("150000");
  });
});
