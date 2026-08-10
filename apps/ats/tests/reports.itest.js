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
  const roles = await import("../../../packages/auth/src/roles");
  return { getViewer: vi.fn(), withViewer: rls.withViewer, isRecruiter: roles.isRecruiter };
});

import { getViewer, withViewer } from "@hris/auth";
import {
  getFunnelReport,
  getSourceReport,
  getTimeReport,
  getReqAgingReport,
  getInterviewerLoadReport,
} from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const stageCount = (funnel, stage) => funnel.find((f) => f.stage === stage).reached;

// Hire Luis for real (stage + a backdated HIRED event), as the ATS would. Runs as Raj, who can
// manage job-be. Backdating is the seeder's privilege — the app can't set occurredAt.
async function hireLuis() {
  await withViewer(V.raj, async (tx) => {
    await tx.$executeRaw`UPDATE "Application" SET stage = 'HIRED' WHERE id = 'app-luis'`;
    await tx.$executeRaw`
      INSERT INTO "ApplicationEvent" (id, "fromStage", "toStage", "occurredAt", "applicationId", "jobId", "actorId")
      VALUES (gen_random_uuid()::text, 'OFFER', 'HIRED', '2026-08-10T10:00:00Z', 'app-luis', 'job-be',
              ${V.raj.userId})`;
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("scoping — the same code, different numbers", () => {
  it("a recruiter's funnel spans every req; a hiring manager's covers only theirs", async () => {
    as(V.raj);
    const orgWide = await getFunnelReport();
    as(V.marcus); // HIRING_MANAGER on job-be only
    const mine = await getFunnelReport();

    // Owen's design-req application is invisible to Marcus, so his APPLIED count is strictly lower.
    expect(stageCount(orgWide.funnel, "APPLIED")).toBeGreaterThan(stageCount(mine.funnel, "APPLIED"));
    expect(orgWide.totalApplications).toBeGreaterThan(mine.totalApplications);
  });

  it("someone off every hiring team sees an empty report, not an error", async () => {
    as(V.priya);
    const r = await getFunnelReport();
    expect(r.totalApplications).toBe(0);
    expect(r.funnel.every((f) => f.reached === 0)).toBe(true);
    expect(await getSourceReport()).toEqual([]);
    expect(await getReqAgingReport()).toEqual([]);
  });
});

describe("the funnel counts EVER REACHED, not currently-at", () => {
  it("counts a candidate at a later stage in every stage they passed through", async () => {
    as(V.raj);
    const { funnel } = await getFunnelReport();
    // Luis is at OFFER, Mei at INTERVIEW, Owen at SCREEN, Nora at APPLIED (+ Owen's design app).
    // Current-stage counting would give APPLIED = 1; "ever reached" counts all of them.
    expect(stageCount(funnel, "APPLIED")).toBe(5);
    expect(stageCount(funnel, "SCREEN")).toBe(3); // Luis, Mei, Owen
    expect(stageCount(funnel, "INTERVIEW")).toBe(2); // Luis, Mei
    expect(stageCount(funnel, "OFFER")).toBe(1); // Luis
  });

  it("counts a multi-round INTERVIEW advance once, not once per round", async () => {
    as(V.raj);
    const { funnel } = await getFunnelReport();
    // Mei has TWO INTERVIEW events (entering, then advancing a round). She is one candidate.
    expect(stageCount(funnel, "INTERVIEW")).toBe(2); // Luis + Mei, not 3
  });

  it("reports conversion between consecutive stages", async () => {
    as(V.raj);
    const { funnel } = await getFunnelReport();
    expect(funnel.find((f) => f.stage === "SCREEN").conversionFromPrevious).toBe(60); // 3 of 5
    expect(funnel.find((f) => f.stage === "APPLIED").conversionFromPrevious).toBeNull();
  });
});

describe("time metrics", () => {
  it("returns null (not 0) before there are any hires", async () => {
    as(V.raj);
    const t = await getTimeReport();
    expect(t.timeToHire.days).toBeNull();
    expect(t.timeToHire.sample).toBe(0);
  });

  it("measures time-to-hire from application and time-to-fill from posting", async () => {
    await hireLuis();
    as(V.raj);
    const t = await getTimeReport();
    // Luis applied 2026-07-10, hired 2026-08-10 → 31 days.
    expect(t.timeToHire).toEqual({ days: 31, sample: 1 });
    // job-be was published 2026-06-01 → 70 days. Different question, different number.
    expect(t.timeToFill.days).toBe(70);
    expect(t.timeToFill.days).not.toBe(t.timeToHire.days);
  });
});

describe("source effectiveness", () => {
  it("rolls up applications and hires per source", async () => {
    await hireLuis();
    as(V.raj);
    const rows = await getSourceReport();
    const referral = rows.find((r) => r.source === "Referral");
    expect(referral.applications).toBe(3); // Owen ×2 + Luis
    expect(referral.hires).toBe(1); // Luis
    expect(referral.hireRate).toBe(33.3);
    expect(rows.find((r) => r.source === "LinkedIn").hires).toBe(0);
  });

  it("still counts a hire whose application was later moved off HIRED", async () => {
    // A hire is a historical fact. Counting current stage would let a later edit erase it — and
    // would make this table contradict the funnel, which reads the event trail. (Exactly the
    // inconsistency that showed up in the browser: funnel said 1 hire, sources said 0.)
    await hireLuis();
    await withViewer(V.raj, (tx) => tx.$executeRaw`UPDATE "Application" SET stage='OFFER' WHERE id='app-luis'`);
    as(V.raj);
    const rows = await getSourceReport();
    expect(rows.find((r) => r.source === "Referral").hires).toBe(1);
    // …and the funnel agrees, which is the point.
    const { funnel } = await getFunnelReport();
    expect(funnel.find((f) => f.stage === "HIRED").reached).toBe(1);
  });
});

describe("requisition aging", () => {
  it("lists only OPEN reqs, oldest first, with candidates in flight", async () => {
    as(V.raj);
    const rows = await getReqAgingReport();
    expect(rows.every((r) => r.daysOpen >= 0)).toBe(true);
    expect(rows.map((r) => r.id)).toContain("job-be");
    // Sorted oldest-first.
    expect(rows).toEqual([...rows].sort((a, b) => b.daysOpen - a.daysOpen));
    expect(rows.find((r) => r.id === "job-be").inFlight).toBeGreaterThan(0);
  });

  it("excludes a req once it's no longer OPEN", async () => {
    await withViewer(V.raj, (tx) => tx.$executeRaw`UPDATE "Job" SET status='FILLED' WHERE id='job-be'`);
    as(V.raj);
    expect((await getReqAgingReport()).map((r) => r.id)).not.toContain("job-be");
  });
});

describe("interviewer load is gated", () => {
  it("is hidden from an interviewer — the anchoring guard would make the totals wrong", async () => {
    as(V.tom); // INTERVIEWER on job-be, manages nothing
    expect(await getInterviewerLoadReport()).toBeNull();
  });

  it("is available to a recruiter, with submitted/draft counts", async () => {
    as(V.raj);
    const rows = await getInterviewerLoadReport();
    expect(Array.isArray(rows)).toBe(true);
    const diego = rows.find((r) => r.name === "Diego Santos");
    expect(diego.submitted).toBe(1); // his seeded scorecard on Mei
  });
});
