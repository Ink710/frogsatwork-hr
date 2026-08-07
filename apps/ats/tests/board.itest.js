import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// getT/getLocale + revalidatePath call request-scoped APIs (cookies / the router cache) that throw
// outside a Next request. Mock them to no-ops / a real EN translator; the actions always run in a
// request scope in prod. getViewer is mocked per-test to act as a given persona; withViewer is REAL
// so the RLS round-trip is genuinely exercised.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("../lib/i18n.ts");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { getViewer, withViewer } from "@hris/auth";
import { moveApplication, advanceRound } from "../app/jobs/actions.js";
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
