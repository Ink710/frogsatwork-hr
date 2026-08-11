import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.9"]]) }));
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
import { prisma } from "@hris/database";
import { submitApplication, requestErasure } from "../app/careers/actions.js";
import { eraseCandidate, refuseErasureRequest } from "../app/(internal)/compliance/actions.js";
import {
  getEeoSummary,
  getErasureRequests,
  canManageErasure,
  getCandidates,
  getFunnelReport,
  getSourceReport,
  getTimeReport,
} from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000007", employeeId: "40000000-0000-0000-0000-000000000007", role: "HR_GENERALIST", orgId: ORG },
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);

const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

// Both public actions redirect on success; treat a thrown NEXT_REDIRECT as "accepted".
const swallowRedirect = async (fn) => {
  try {
    return (await fn()) ?? {};
  } catch (e) {
    if (e.__redirect) return { ok: true };
    throw e;
  }
};

const erase = (candidateId, extra = {}) =>
  eraseCandidate(candidateId, undefined, fd({ confirm: "ERASE", note: "GDPR request", ...extra }));

// Hire Luis for real, as M8's seam would — the setup for the "erasure refused" case. Runs through
// withViewer because Application is RLS'd (bare prisma would silently affect nothing).
async function hireLuis() {
  await withViewer(V.ana, async (tx) => {
    await tx.$executeRaw`UPDATE "Application" SET stage = 'HIRED' WHERE id = 'app-luis'`;
    // app_link_hire returns a scalar text code, not a table.
    await tx.$queryRaw`SELECT app_link_hire('app-luis', '40000000-0000-0000-0000-000000000003')`;
  });
}

beforeEach(async () => {
  await resetDb();
  as(V.ana);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("EEO responses are unreadable, by construction", () => {
  it("cannot be read through Prisma by an HR admin — the strongest claim this feature makes", async () => {
    // Not "returns an empty list because of a where clause": the table has RLS with no policies and
    // every privilege revoked, so the query itself is refused. If this test ever starts passing by
    // returning [], the guarantee has been weakened somewhere.
    await expect(withViewer(V.ana, (tx) => tx.eeoResponse.findMany())).rejects.toThrow();
  });

  it("cannot be read by a recruiter either", async () => {
    await expect(withViewer(V.raj, (tx) => tx.eeoResponse.findMany())).rejects.toThrow();
  });

  it("cannot be reached through the Application relation", async () => {
    await expect(
      withViewer(V.ana, (tx) =>
        tx.application.findMany({ where: { id: "app-mei" }, include: { eeoResponse: true } }),
      ),
    ).rejects.toThrow();
  });

  it("is not readable even with the raw connection the app uses", async () => {
    await expect(prisma.$queryRaw`SELECT * FROM "EeoResponse"`).rejects.toThrow();
  });
});

describe("EEO aggregates", () => {
  it("are returned to an HR admin", async () => {
    const summary = await getEeoSummary();
    expect(summary).not.toBeNull();
    expect(summary.totalResponses).toBe(5); // the five seeded applications
    const gender = summary.dimensions.find((d) => d.dimension === "gender");
    expect(gender.total).toBe(5);
  });

  it("every dimension sums to the same total, because DECLINED is stored not null", async () => {
    const { dimensions } = await getEeoSummary();
    expect(dimensions).toHaveLength(4);
    expect(new Set(dimensions.map((d) => d.total))).toEqual(new Set([5]));
  });

  it("are returned to an HR generalist too (WIDENED in M12)", async () => {
    // M10 kept this HR_ADMIN-only on the explicit grounds that no task in the app required a
    // generalist to see it. M12 built that task — the EEO-1 export — so the gate widened by one
    // role. This assertion CHANGED deliberately; it is not a regression.
    as(V.bianca);
    expect(await getEeoSummary()).not.toBeNull();
  });

  it("are still refused for a recruiter, a hiring manager and an interviewer", async () => {
    for (const persona of [V.raj, V.marcus, V.diego]) {
      as(persona);
      // null, NOT an empty summary — "you may not see this" and "there is no data" are different
      // sentences, and a compliance report must never confuse them.
      expect(await getEeoSummary()).toBeNull();
    }
  });

  it("suppresses every small cell in the seeded pool (5 responses, threshold 5)", async () => {
    const { dimensions } = await getEeoSummary();
    // With this little data the honest report is almost entirely withheld. That is the rule working,
    // not a bug — SEED_DEMO_VOLUME=1 exists to give the demo a pool big enough to show numbers.
    expect(dimensions.every((d) => d.hasSuppression)).toBe(true);
  });

  it("can be narrowed to one requisition", async () => {
    const beOnly = await getEeoSummary({ jobId: "job-be" });
    expect(beOnly.totalResponses).toBe(4); // Owen's design application is the fifth
  });
});

describe("EEO capture on the public apply path", () => {
  const applicant = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    eeoGender: "FEMALE",
    eeoEthnicity: "WHITE",
    eeoVeteranStatus: "NOT_A_VETERAN",
    eeoDisabilityStatus: "NO",
  };

  it("records the answers with the application", async () => {
    await swallowRedirect(() => submitApplication("job-be", undefined, fd(applicant)));
    const { totalResponses } = await getEeoSummary();
    expect(totalResponses).toBe(6);
  });

  it("records DECLINED when the applicant answers nothing", async () => {
    await swallowRedirect(() =>
      submitApplication("job-be", undefined, fd({ firstName: "Alan", lastName: "Turing", email: "alan@example.com" })),
    );
    const { dimensions } = await getEeoSummary();
    const declined = dimensions
      .find((d) => d.dimension === "gender")
      .cells.find((c) => c.value === "DECLINED");
    expect(declined).toBeDefined(); // present as a value, not missing as a null
  });

  it("does NOT let a nonsense value cost someone their application", async () => {
    const res = await swallowRedirect(() =>
      submitApplication(
        "job-be",
        undefined,
        fd({ firstName: "Grace", lastName: "Hopper", email: "grace@example.com", eeoGender: "<script>" }),
      ),
    );
    expect(res.error).toBeUndefined();
    const apps = await withViewer(V.ana, (tx) =>
      tx.candidate.findMany({ where: { email: "grace@example.com" } }),
    );
    expect(apps).toHaveLength(1);
  });

  it("writes no response for a duplicate application", async () => {
    await swallowRedirect(() => submitApplication("job-be", undefined, fd(applicant)));
    const before = (await getEeoSummary()).totalResponses;
    const res = await submitApplication("job-be", undefined, fd(applicant));
    expect(res.error).toBeTruthy(); // DUPLICATE
    expect((await getEeoSummary()).totalResponses).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("the public erasure request", () => {
  it("records a request for an address we hold", async () => {
    await swallowRedirect(() =>
      requestErasure(undefined, fd({ email: "nora.adeyemi@example.com", reason: "Please remove me" })),
    );
    const queue = await getErasureRequests();
    expect(queue.some((r) => r.candidateId === "cand-nora")).toBe(true);
  });

  it("records NOTHING for an address we don't hold — and says the same thing either way", async () => {
    const before = (await getErasureRequests()).length;
    const res = await swallowRedirect(() =>
      requestErasure(undefined, fd({ email: "stranger@example.com", reason: "n/a" })),
    );
    expect(res.error).toBeUndefined(); // indistinguishable from the matched case
    expect((await getErasureRequests()).length).toBe(before);
  });

  it("does not stack duplicate requests for the same person", async () => {
    await swallowRedirect(() => requestErasure(undefined, fd({ email: "mei.tanaka@example.com" })));
    await swallowRedirect(() => requestErasure(undefined, fd({ email: "mei.tanaka@example.com" })));
    const forMei = (await getErasureRequests()).filter((r) => r.candidateId === "cand-mei");
    expect(forMei).toHaveLength(1);
  });

  it("rejects a malformed address — the one thing it's safe to report back", async () => {
    const res = await requestErasure(undefined, fd({ email: "not-an-email" }));
    expect(res.error).toBeTruthy();
  });

  it("keeps the queue invisible to a recruiter", async () => {
    as(V.raj);
    expect(await getErasureRequests()).toHaveLength(0);
    expect(await canManageErasure()).toBe(false);
  });
});

describe("erasing a candidate", () => {
  it("destroys the identity and keeps the shell", async () => {
    const res = await erase("cand-mei");
    expect(res.error).toBeUndefined();

    const [shell] = await withViewer(V.ana, (tx) =>
      tx.candidate.findMany({ where: { id: "cand-mei" } }),
    );
    expect(shell.firstName).toBe("Erased");
    expect(shell.email).toMatch(/^erased\+.*@anonymised\.invalid$/);
    expect(shell.phone).toBeNull();
    expect(shell.resumeKey).toBeNull();
    expect(shell.anonymisedAt).not.toBeNull();
    expect(shell.anonymisedById).toBe(V.ana.employeeId);
    expect(shell.anonymisationNote).toBe("GDPR request");
    // The channel survives — it describes where an application came from, not who sent it.
    expect(shell.source).toBe("Careers page");
  });

  it("blanks free text that could name them, across all four places it hides", async () => {
    await withViewer(V.ana, (tx) => tx.$executeRaw`
      UPDATE "Application" SET "rejectionReason" = 'Mei withdrew after the onsite' WHERE id = 'app-mei'`);

    await erase("cand-mei");

    const rows = await withViewer(V.ana, async (tx) => ({
      applications: await tx.application.findMany({ where: { candidateId: "cand-mei" } }),
      events: await tx.applicationEvent.findMany({ where: { applicationId: "app-mei" } }),
      scorecards: await tx.scorecard.findMany({ where: { applicationId: "app-mei" } }),
      ratings: await tx.scorecardRating.findMany({ where: { scorecardId: "sc-diego-mei" } }),
    }));

    expect(rows.applications.every((a) => a.rejectionReason === null)).toBe(true);
    expect(rows.events.every((e) => e.note === null)).toBe(true);
    expect(rows.scorecards.every((s) => s.notes === null)).toBe(true);
    expect(rows.ratings.every((r) => r.comment === null)).toBe(true);
  });

  it("leaves the append-only history itself intact — stages, timestamps and ratings all survive", async () => {
    const before = await withViewer(V.ana, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-mei" }, orderBy: { occurredAt: "asc" } }),
    );
    await erase("cand-mei");
    const after = await withViewer(V.ana, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-mei" }, orderBy: { occurredAt: "asc" } }),
    );

    expect(after.map((e) => e.toStage)).toEqual(before.map((e) => e.toStage));
    expect(after.map((e) => e.occurredAt.toISOString())).toEqual(
      before.map((e) => e.occurredAt.toISOString()),
    );
    const ratings = await withViewer(V.ana, (tx) =>
      tx.scorecardRating.findMany({ where: { scorecardId: "sc-diego-mei" } }),
    );
    expect(ratings.every((r) => r.rating >= 1)).toBe(true);
  });

  it("closes the pending request that asked for it", async () => {
    await erase("cand-nora"); // the seeded request er-nora is for Nora
    const pending = await getErasureRequests({ status: "PENDING" });
    expect(pending.some((r) => r.candidateId === "cand-nora")).toBe(false);
    const completed = await getErasureRequests({ status: "COMPLETED" });
    expect(completed.some((r) => r.candidateId === "cand-nora")).toBe(true);
  });

  it("REFUSES to erase someone who was hired — retention outranks the erasure right", async () => {
    await hireLuis();
    const res = await erase("cand-luis");
    expect(res.error).toMatch(/employment law/i);

    const [luis] = await withViewer(V.ana, (tx) => tx.candidate.findMany({ where: { id: "cand-luis" } }));
    expect(luis.anonymisedAt).toBeNull();
    expect(luis.firstName).toBe("Luis");
  });

  it("is refused for a recruiter and for an HR generalist", async () => {
    for (const persona of [V.raj, V.bianca]) {
      as(persona);
      const res = await erase("cand-mei");
      expect(res.error).toBeTruthy();
    }
    as(V.ana);
    const [mei] = await withViewer(V.ana, (tx) => tx.candidate.findMany({ where: { id: "cand-mei" } }));
    expect(mei.anonymisedAt).toBeNull();
  });

  it("requires the typed confirmation", async () => {
    const res = await eraseCandidate("cand-mei", undefined, fd({ confirm: "yes", note: "x" }));
    expect(res.error).toBeTruthy();
    const [mei] = await withViewer(V.ana, (tx) => tx.candidate.findMany({ where: { id: "cand-mei" } }));
    expect(mei.anonymisedAt).toBeNull();
  });

  it("is idempotent — a retry reports the state instead of failing loudly", async () => {
    await erase("cand-mei");
    const res = await erase("cand-mei");
    expect(res.error).toMatch(/already/i);
  });
});

describe("refusing a request", () => {
  it("records the decision and the reason", async () => {
    const [req] = await getErasureRequests({ status: "PENDING" });
    const res = await refuseErasureRequest(req.id, undefined, fd({ note: "They are now an employee." }));
    expect(res.error).toBeUndefined();

    const [refused] = await getErasureRequests({ status: "REFUSED" });
    expect(refused.decisionNote).toBe("They are now an employee.");
    expect(refused.resolvedAt).not.toBeNull();
  });

  it("requires a note — an unexplained refusal is the gap an auditor looks for", async () => {
    const [req] = await getErasureRequests({ status: "PENDING" });
    const res = await refuseErasureRequest(req.id, undefined, fd({ note: "  " }));
    expect(res.error).toBeTruthy();
  });

  it("is refused for a recruiter", async () => {
    const [req] = await getErasureRequests({ status: "PENDING" });
    as(V.raj);
    const res = await refuseErasureRequest(req.id, undefined, fd({ note: "no" }));
    expect(res.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("what an erasure must NOT change", () => {
  it("leaves every reporting figure identical — destroy the person, keep the statistics", async () => {
    const before = {
      funnel: await getFunnelReport(),
      sources: await getSourceReport(),
      times: await getTimeReport(),
    };

    await erase("cand-mei");

    const after = {
      funnel: await getFunnelReport(),
      sources: await getSourceReport(),
      times: await getTimeReport(),
    };

    // This is the test the whole design exists to pass. If erasure ever starts deleting rows
    // instead of scrubbing them, every one of these numbers moves.
    expect(after.funnel).toEqual(before.funnel);
    expect(after.sources).toEqual(before.sources);
    expect(after.times).toEqual(before.times);
  });

  it("keeps the EEO aggregate intact — historical compliance figures must not move", async () => {
    const before = await getEeoSummary();
    await erase("cand-mei");
    expect(await getEeoSummary()).toEqual(before);
  });
});

describe("the candidate list after an erasure", () => {
  it("hides the shell by default", async () => {
    const before = await getCandidates();
    await erase("cand-mei");
    const after = await getCandidates();
    expect(after.total).toBe(before.total - 1);
    expect(after.rows.some((r) => r.id === "cand-mei")).toBe(false);
  });

  it("shows it when asked, so the pool reconciles with the reports", async () => {
    await erase("cand-mei");
    const withShells = await getCandidates({ includeAnonymised: true });
    const shell = withShells.rows.find((r) => r.id === "cand-mei");
    expect(shell).toBeDefined();
    expect(shell.anonymisedAt).not.toBeNull();
  });

  it("keeps their applications searchable by job and stage — the history is still there", async () => {
    await erase("cand-mei");
    const res = await getCandidates({ jobId: "job-be", includeAnonymised: true });
    expect(res.rows.some((r) => r.id === "cand-mei")).toBe(true);
  });
});
