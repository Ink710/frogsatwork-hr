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
import { saveScorecardDraft, submitScorecard } from "../app/(internal)/jobs/scorecards.js";
import { addCompetency } from "../app/(internal)/jobs/actions.js";
import { getApplicationScorecards, getMyScorecard } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const MEI = "app-mei";
// Seeded competencies on job-be.
const COMPS = ["jc-be-design", "jc-be-coding", "jc-be-comms"];

// A complete submission: every competency rated + a recommendation.
const fullForm = (recommendation = "YES") => {
  const f = new FormData();
  f.set("recommendation", recommendation);
  f.set("notes", "Solid across the board.");
  for (const c of COMPS) f.set(`rating:${c}`, "3");
  return f;
};

beforeEach(async () => {
  await resetDb();
});

describe("the anchoring guard", () => {
  it("hides a colleague's feedback until you've submitted your own — but says HOW MANY are hidden", async () => {
    // Tom is an INTERVIEWER on job-be with nothing submitted. Diego has a SUBMITTED scorecard.
    as(V.tom);
    const before = await getApplicationScorecards(MEI);
    expect(before.scorecards).toHaveLength(0); // Diego's is withheld…
    expect(before.hiddenCount).toBe(1); // …but its existence is not a secret

    expect((await submitScorecard(MEI, undefined, fullForm())).ok).toBe(true);

    const after = await getApplicationScorecards(MEI);
    expect(after.scorecards).toHaveLength(2); // his + Diego's, now unlocked
    expect(after.hiddenCount).toBe(0);
    expect(after.scorecards.some((s) => s.authorName === "Diego Santos")).toBe(true);
  });

  it("lets a recruiter and a hiring manager read everything without submitting anything", async () => {
    for (const persona of [V.raj, V.marcus]) {
      as(persona);
      const r = await getApplicationScorecards(MEI);
      expect(r.scorecards).toHaveLength(1); // Diego's
      expect(r.hiddenCount).toBe(0);
    }
  });

  it("shows nothing at all to someone off the hiring team", async () => {
    as(V.priya); // not a JobMember on job-be
    const r = await getApplicationScorecards(MEI);
    expect(r.scorecards).toHaveLength(0);
    expect(r.hiddenCount).toBe(0); // not even a count — the counter is gated too
  });

  it("still lets you read your OWN draft before submitting", async () => {
    as(V.tom);
    await saveScorecardDraft(MEI, undefined, fullForm());
    const r = await getApplicationScorecards(MEI);
    expect(r.scorecards).toHaveLength(1);
    expect(r.scorecards[0].isMine).toBe(true);
    expect(r.scorecards[0].status).toBe("DRAFT");
    expect(r.hiddenCount).toBe(1); // Diego's still hidden — a draft doesn't unlock anything
  });
});

describe("ownership and the submit lock", () => {
  it("refuses to edit a scorecard once submitted — at the database, not just the action", async () => {
    as(V.tom);
    await submitScorecard(MEI, undefined, fullForm());
    const mine = await getMyScorecard(MEI);
    expect(mine.scorecard.status).toBe("SUBMITTED");

    // The action refuses…
    const again = await saveScorecardDraft(MEI, undefined, fullForm("NO"));
    expect(again.error).toBeTruthy();

    // …and so does a direct UPDATE that bypasses the action entirely.
    const updated = await withViewer(V.tom, (tx) =>
      tx.scorecard.updateMany({ where: { id: mine.scorecard.id }, data: { notes: "sneaky" } }),
    );
    expect(updated.count).toBe(0);
  });

  it("refuses to modify someone else's scorecard", async () => {
    as(V.tom);
    const diegoCard = await withViewer(V.raj, (tx) =>
      tx.scorecard.findFirst({ where: { applicationId: MEI, authorEmployeeId: V.diego.employeeId } }),
    );
    const updated = await withViewer(V.tom, (tx) =>
      tx.scorecard.updateMany({ where: { id: diegoCard.id }, data: { notes: "tampered" } }),
    );
    expect(updated.count).toBe(0);
  });

  it("refuses to create a scorecard authored by someone else", async () => {
    await expect(
      withViewer(V.tom, (tx) =>
        tx.scorecard.create({
          data: {
            applicationId: MEI,
            jobId: "job-be",
            authorEmployeeId: V.diego.employeeId, // forged author
            status: "DRAFT",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("completeness", () => {
  it("refuses to submit without a recommendation", async () => {
    as(V.tom);
    const f = fullForm();
    f.delete("recommendation");
    expect((await submitScorecard(MEI, undefined, f)).error).toBeTruthy();
  });

  it("refuses to submit with a competency unrated, and names it", async () => {
    as(V.tom);
    const f = fullForm();
    f.delete(`rating:${COMPS[1]}`); // "Coding"
    const res = await submitScorecard(MEI, undefined, f);
    expect(res.error).toMatch(/Coding/);
  });

  it("allows an incomplete DRAFT — an interview is half-finished most of the time", async () => {
    as(V.tom);
    const f = new FormData();
    f.set(`rating:${COMPS[0]}`, "4");
    expect((await saveScorecardDraft(MEI, undefined, f)).ok).toBe(true);
  });
});

describe("competency snapshots", () => {
  it("keeps submitted ratings readable after the competency is renamed", async () => {
    as(V.raj);
    // Diego's seeded scorecard rated "System design". Rename the competency…
    await withViewer(V.raj, (tx) =>
      tx.jobCompetency.update({ where: { id: "jc-be-design" }, data: { name: "Architecture" } }),
    );
    const r = await getApplicationScorecards(MEI);
    const names = r.scorecards[0].ratings.map((x) => x.competencyName);
    // …the debrief still says what it said at the time.
    expect(names).toContain("System design");
    expect(names).not.toContain("Architecture");
  });
});

describe("competency management is manage-gated", () => {
  it("refuses an interviewer", async () => {
    as(V.diego); // INTERVIEWER on job-be
    const f = new FormData();
    f.set("name", "Culture");
    expect((await addCompetency("job-be", undefined, f)).error).toBeTruthy();
  });

  it("allows a recruiter", async () => {
    as(V.raj);
    const f = new FormData();
    f.set("name", "Culture");
    expect((await addCompetency("job-be", undefined, f)).ok).toBe(true);
  });
});
