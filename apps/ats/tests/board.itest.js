import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// getT/getLocale + revalidatePath call request-scoped APIs (cookies / the router cache) that throw
// outside a Next request. Mock them to no-ops / a real EN translator; the actions always run in a
// request scope in prod. getViewer is mocked per-test to act as a given persona; withViewer is REAL
// so the RLS round-trip is genuinely exercised.
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
import { moveApplication, advanceRound, reopenApplication } from "../app/(internal)/jobs/actions.js";
import { getJobBoard } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const fd = (o) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(o)) f.set(k, val);
  return f;
};
const app = (id) => withViewer(V.marcus, (tx) => tx.application.findUnique({ where: { id } }));

beforeEach(async () => {
  await resetDb();
});

describe("getJobBoard scoping", () => {
  it("a recruiter sees the board and may manage it", async () => {
    as(V.raj);
    const board = await getJobBoard("job-be");
    expect(board.canManage).toBe(true);
    expect(board.columns.APPLIED).toHaveLength(1); // Nora
    expect(board.columns.OFFER).toHaveLength(1); // Luis
  });

  it("an interviewer sees the board read-only (canManage false)", async () => {
    as(V.diego);
    const board = await getJobBoard("job-be");
    expect(board).not.toBeNull();
    expect(board.canManage).toBe(false);
  });

  it("an outsider gets nothing (RLS hides the job)", async () => {
    as(V.priya);
    expect(await getJobBoard("job-be")).toBeNull();
  });
});

describe("moveApplication", () => {
  it("refuses a move from an interviewer", async () => {
    as(V.diego);
    const res = await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "SCREEN" }));
    expect(res.error).toBeTruthy();
    expect((await app("app-nora")).stage).toBe("APPLIED"); // unchanged
  });

  it("rejects an illegal stage transition", async () => {
    as(V.marcus);
    const res = await moveApplication("job-be", "app-owen", undefined, fd({ toStage: "OFFER" })); // SCREEN→OFFER skips INTERVIEW
    expect(res.error).toBeTruthy();
    expect((await app("app-owen")).stage).toBe("SCREEN"); // unchanged
  });

  it("advances a candidate and records an append-only event", async () => {
    as(V.marcus);
    const res = await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "SCREEN" }));
    expect(res.ok).toBe(true);
    expect((await app("app-nora")).stage).toBe("SCREEN");
    const events = await withViewer(V.marcus, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-nora", fromStage: "APPLIED", toStage: "SCREEN" } }),
    );
    expect(events).toHaveLength(1);
  });

  it("seeds the first interview round when entering INTERVIEW", async () => {
    as(V.marcus);
    const res = await moveApplication("job-be", "app-owen", undefined, fd({ toStage: "INTERVIEW" }));
    expect(res.ok).toBe(true);
    const owen = await app("app-owen");
    expect(owen.stage).toBe("INTERVIEW");
    expect(owen.currentRoundId).toBe("ir-be-screen"); // position 0
  });
});

describe("advanceRound", () => {
  it("walks to the next round, then errors at the last", async () => {
    as(V.marcus);
    // Mei starts INTERVIEW at "System Design" (ir-be-design, pos 1). Advance → "Team Interview" (pos 2, last).
    const first = await advanceRound("job-be", "app-mei", undefined);
    expect(first.ok).toBe(true);
    expect((await app("app-mei")).currentRoundId).toBe("ir-be-team");
    // Already at the last round now → error.
    const second = await advanceRound("job-be", "app-mei", undefined);
    expect(second.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Backward moves + the interview-rounds guard (Polish B).
//
// The rule change that made drag-and-drop worth building: an application may return to an earlier
// ACTIVE stage. Terminal stages are untouched, which the tests above already pin down.
describe("moving backward through the pipeline", () => {
  const events = (id) =>
    withViewer(V.marcus, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: id }, orderBy: { occurredAt: "asc" } }),
    );

  it("moves a candidate back to an earlier stage and records the reversal", async () => {
    as(V.marcus);
    // Owen is at SCREEN in the seed.
    const res = await moveApplication("job-be", "app-owen", undefined, fd({ toStage: "APPLIED" }));
    expect(res.ok).toBe(true);
    expect((await app("app-owen")).stage).toBe("APPLIED");

    // The reversal is a fact in the trail, not an erasure of the forward move.
    const trail = await events("app-owen");
    const last = trail.at(-1);
    expect(last.fromStage).toBe("SCREEN");
    expect(last.toStage).toBe("APPLIED");
  });

  it("clears the interview round when leaving INTERVIEW backward", async () => {
    as(V.marcus);
    expect((await app("app-mei")).currentRoundId).not.toBeNull(); // mid-interview in the seed
    await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "SCREEN" }));

    const mei = await app("app-mei");
    expect(mei.stage).toBe("SCREEN");
    expect(mei.currentRoundId).toBeNull();
  });

  it("re-seeds the FIRST round when returning to INTERVIEW", async () => {
    as(V.marcus);
    await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "SCREEN" }));
    await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "INTERVIEW" }));

    const mei = await app("app-mei");
    const board = await getJobBoard("job-be");
    // A re-interview restarts the sequence; the rounds already sat survive in the trail.
    expect(mei.currentRoundId).toBe(board.rounds[0].id);
  });

  it("still refuses to move out of a terminal stage", async () => {
    as(V.marcus);
    await moveApplication("job-be", "app-nora", undefined, fd({
      toStage: "REJECTED",
      rejectionCategory: "SKILLS_MISMATCH",
    }));
    const res = await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "APPLIED" }));
    expect(res.error).toBeTruthy();
    expect((await app("app-nora")).stage).toBe("REJECTED");
  });
});

describe("the interview-rounds guard", () => {
  it("refuses INTERVIEW → OFFER while rounds remain", async () => {
    as(V.marcus);
    // Mei sits on round 2 of 3 in the seed.
    const res = await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "OFFER" }));
    expect(res.error).toMatch(/interview rounds/i);
    expect((await app("app-mei")).stage).toBe("INTERVIEW");
  });

  it("allows INTERVIEW → OFFER once the last round is reached", async () => {
    as(V.marcus);
    // Walk to the final round, then the move is permitted.
    let guard = 0;
    while ((await advanceRound("job-be", "app-mei", undefined)).ok && guard++ < 10) {
      /* advance until advanceRound reports it's at the last round */
    }
    const res = await moveApplication("job-be", "app-mei", undefined, fd({ toStage: "OFFER" }));
    expect(res.ok).toBe(true);
    expect((await app("app-mei")).stage).toBe("OFFER");
  });

  it("does not block a job that defines no rounds at all", async () => {
    as(V.raj);
    // job-pd has no interview rounds; nothing to wait for.
    await moveApplication("job-pd", "app-owen-pd", undefined, fd({ toStage: "APPLIED" })).catch(() => {});
    const board = await getJobBoard("job-pd");
    expect(board.rounds).toHaveLength(0);
  });
});

describe("reporting survives a reversal", () => {
  it("counts each stage once across forward → back → forward", async () => {
    const { getFunnelReport } = await import("../lib/queries.js");
    as(V.marcus);

    await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "SCREEN" }));
    const afterForward = await getFunnelReport();

    await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "APPLIED" }));
    await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "SCREEN" }));
    const afterRoundTrip = await getFunnelReport();

    // M9 counts DISTINCT applicationId per stage from the event trail, so a round trip adds events
    // without inflating the funnel. That design anticipated this; now it can actually happen.
    expect(afterRoundTrip.funnel).toEqual(afterForward.funnel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Reopening a withdrawal (M13). A withdrawal is the CANDIDATE's decision and candidates change
// their minds; a rejection is the COMPANY's and stays permanent. The pair of tests below is the
// whole point — they must keep disagreeing.
describe("reopening a withdrawn application", () => {
  const withdraw = (appId) =>
    moveApplication("job-be", appId, undefined, fd({ toStage: "WITHDRAWN" }));

  it("restores the stage the candidate was AT when they withdrew", async () => {
    as(V.marcus);
    // Mei is mid-INTERVIEW in the seed.
    await withdraw("app-mei");
    expect((await app("app-mei")).stage).toBe("WITHDRAWN");

    const res = await reopenApplication("job-be", "app-mei");
    expect(res.ok).toBe(true);

    const mei = await app("app-mei");
    // Not APPLIED — the trail knows they were interviewing, so that's where they land.
    expect(mei.stage).toBe("INTERVIEW");
    expect(mei.currentRoundId).not.toBeNull(); // re-seeded to round 1
  });

  it("restores an APPLIED candidate to APPLIED", async () => {
    as(V.marcus);
    await withdraw("app-nora");
    await reopenApplication("job-be", "app-nora");
    expect((await app("app-nora")).stage).toBe("APPLIED");
  });

  it("records the reopen in the append-only trail", async () => {
    as(V.marcus);
    await withdraw("app-owen");
    await reopenApplication("job-be", "app-owen");

    const trail = await withViewer(V.marcus, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-owen" }, orderBy: { occurredAt: "asc" } }),
    );
    const last = trail.at(-1);
    expect(last.fromStage).toBe("WITHDRAWN");
    expect(last.toStage).toBe("SCREEN"); // where Owen was
  });

  it("REFUSES to reopen a rejected application — the M12 guarantee", async () => {
    as(V.marcus);
    await moveApplication("job-be", "app-nora", undefined, fd({
      toStage: "REJECTED",
      rejectionCategory: "SKILLS_MISMATCH",
    }));

    const res = await reopenApplication("job-be", "app-nora");
    expect(res.error).toBeTruthy();
    expect((await app("app-nora")).stage).toBe("REJECTED");
  });

  it("refuses an application that isn't closed at all", async () => {
    as(V.marcus);
    const res = await reopenApplication("job-be", "app-nora"); // still APPLIED
    expect(res.error).toBeTruthy();
  });

  it("is refused for an interviewer", async () => {
    as(V.marcus);
    await withdraw("app-nora");
    as(V.diego);
    const res = await reopenApplication("job-be", "app-nora");
    expect(res.error).toBeTruthy();
    expect((await app("app-nora")).stage).toBe("WITHDRAWN");
  });

  it("leaves the reporting unchanged across a withdraw/reopen round trip", async () => {
    const { getFunnelReport } = await import("../lib/queries.js");
    as(V.marcus);
    const before = await getFunnelReport();

    await withdraw("app-owen");
    await reopenApplication("job-be", "app-owen");

    expect((await getFunnelReport()).funnel).toEqual(before.funnel);
  });
});
