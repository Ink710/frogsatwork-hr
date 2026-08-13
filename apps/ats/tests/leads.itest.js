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
import { markLead, unmarkLead } from "../app/(internal)/candidates/lead.js";
import { archiveCandidate } from "../app/(internal)/candidates/archive.js";
import { getLeadPool, getCandidates, getCandidateProfile } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const noteForm = (note) => {
  const f = new FormData();
  if (note !== undefined) f.set("note", note);
  return f;
};
const row = (id) => withViewer(V.raj, (tx) => tx.candidate.findUnique({ where: { id } }));

// cand-owen is seeded AS a lead (REJECTED on job-pd, SCREEN on job-be). cand-nora is not.
const OWEN = "cand-owen";
const NORA = "cand-nora";

beforeEach(async () => {
  await resetDb();
});

describe("who may mark a lead", () => {
  it("lets a recruiter mark someone", async () => {
    as(V.raj);
    expect((await markLead(NORA, undefined, noteForm("Sharp — keep warm."))).ok).toBe(true);
    const c = await row(NORA);
    expect(c.leadMarkedAt).not.toBeNull();
    expect(c.leadMarkedById).toBe(V.raj.employeeId);
    expect(c.leadNote).toBe("Sharp — keep warm.");
  });

  it("lets a HIRING MANAGER mark someone on their own req", async () => {
    // Marcus is HIRING_MANAGER on job-be, and Nora applied there.
    as(V.marcus);
    expect((await markLead(NORA, undefined, noteForm("Strong."))).ok).toBe(true);
    expect((await row(NORA)).leadMarkedById).toBe(V.marcus.employeeId);
  });

  it("REFUSES an interviewer — and this is the check RLS cannot make", async () => {
    // Proven in psql: Diego's raw UPDATE on this row returns "UPDATE 1", because he can SEE the
    // candidate (app_can_see_candidate) and candidate_visibility is FOR ALL. The app-layer gate is
    // the only thing standing between him and the mark, which is why it must never be bypassed.
    as(V.diego);
    const res = await markLead(NORA, undefined, noteForm("I liked them"));
    expect(res.error).toBeTruthy();
    expect((await row(NORA)).leadMarkedAt).toBeNull();
  });

  it("refuses someone off the hiring team entirely", async () => {
    as(V.priya);
    expect((await markLead(NORA, undefined, noteForm())).error).toBeTruthy();
    expect((await row(NORA)).leadMarkedAt).toBeNull();
  });

  it("refuses a HIRED candidate — they're staff now, not a future lead", async () => {
    await withViewer(V.ana, (tx) => tx.$executeRaw`UPDATE "Application" SET stage = 'HIRED' WHERE id = 'app-luis'`);
    as(V.raj);
    const res = await markLead("cand-luis", undefined, noteForm("great"));
    expect(res.error).toMatch(/hired/i);
    expect((await row("cand-luis")).leadMarkedAt).toBeNull();
  });

  it("refuses an erased shell — there is nobody left to call", async () => {
    await withViewer(V.ana, (tx) => tx.$queryRaw`SELECT * FROM app_erase_candidate(${NORA}, 'test')`);
    as(V.raj);
    expect((await markLead(NORA, undefined, noteForm("x"))).error).toBeTruthy();
  });

  it("reports canMarkLead on the profile, matching who may actually do it", async () => {
    for (const [persona, expected] of [
      [V.raj, true],
      [V.marcus, true],
      [V.diego, false],
    ]) {
      as(persona);
      expect((await getCandidateProfile(NORA)).canMarkLead).toBe(expected);
    }
  });
});

describe("unmarking", () => {
  it("clears the mark AND the note — an orphaned note is stray prose about a person", async () => {
    as(V.raj);
    expect((await unmarkLead(OWEN)).ok).toBe(true);
    const c = await row(OWEN);
    expect(c.leadMarkedAt).toBeNull();
    expect(c.leadMarkedById).toBeNull();
    expect(c.leadNote).toBeNull();
  });
});

describe("the pool", () => {
  it("lists marked leads with their note and who marked them", async () => {
    as(V.raj);
    const { rows, total } = await getLeadPool();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id: OWEN, leadMarkedByName: "Raj Patel" });
    expect(rows[0].leadNote).toMatch(/staff backend role/);
  });

  it("KEEPS an archived lead in the pool while the candidate list hides them", async () => {
    // THE MILESTONE'S CENTRAL DECISION, as a test. Leads are swept by the retention policy like
    // anyone else, so if the pool inherited the candidate list's "hide archived" default it would
    // quietly empty itself about a year after launch.
    as(V.raj);
    expect((await archiveCandidate(OWEN)).ok).toBe(true);

    const pool = await getLeadPool();
    expect(pool.total).toBe(1);
    expect(pool.rows[0].archivedAt).not.toBeNull(); // …and flagged, so it's honest about it

    const list = await getCandidates({});
    expect(list.rows.some((c) => c.id === OWEN)).toBe(false);
    // Still reachable there on demand, which is what makes the two views reconcilable.
    const withArchived = await getCandidates({ includeArchived: true });
    expect(withArchived.rows.some((c) => c.id === OWEN)).toBe(true);
  });

  it("is RLS-scoped: an outsider sees an empty pool", async () => {
    as(V.priya);
    expect((await getLeadPool()).total).toBe(0);
  });

  it("is RECRUITER/HR only — a hiring manager who CAN mark still cannot browse it", async () => {
    // The asymmetry is the point, not an oversight. Marcus's judgement fills this list (he can mark
    // — see the test above), but RLS would narrow his view to candidates from his own reqs, showing
    // him a fraction of the pool while looking like the whole thing. M9 made the same call about the
    // interviewer-load report: a wrong number is worse than a hidden section.
    as(V.marcus);
    expect((await getLeadPool()).total).toBe(0);

    as(V.diego); // and an interviewer never sees a manager's private read on someone
    expect((await getLeadPool()).total).toBe(0);

    for (const persona of [V.raj, V.ana]) {
      as(persona);
      expect((await getLeadPool()).total).toBe(1);
    }
  });

  it("searches the note, not just the name", async () => {
    as(V.raj);
    expect((await getLeadPool({ q: "staff backend" })).total).toBe(1);
    expect((await getLeadPool({ q: "zebra" })).total).toBe(0);
  });

  it("never lists an erased shell", async () => {
    await withViewer(V.ana, (tx) => tx.$queryRaw`SELECT * FROM app_erase_candidate(${OWEN}, 'test')`);
    as(V.raj);
    expect((await getLeadPool()).total).toBe(0);
  });
});

describe("the note is searchable from the main candidate list", () => {
  it("finds a lead by a word from their note", async () => {
    as(V.raj);
    const found = await getCandidates({ q: "systems depth" });
    expect(found.rows.map((c) => c.id)).toContain(OWEN);
  });

  it("still finds people by name, unchanged", async () => {
    as(V.raj);
    expect((await getCandidates({ q: "Mei Tanaka" })).rows.map((c) => c.id)).toContain("cand-mei");
  });
});
