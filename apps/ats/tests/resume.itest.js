import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { Readable } from "node:stream";
import { resetDb } from "../../../test/resetDb.js";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret"; // the links are HMAC'd with it
});

// Storage is mocked: this file is about ACCESS, not about bytes on disk. `put` is never called here
// (the candidate's resumeKey is set directly), and getStream returns a known buffer so a 200 can be
// asserted without seeding a real file into apps/ats/.storage.
vi.mock("@hris/storage", () => ({
  createStorage: () => ({
    getStream: vi.fn(async (key) => {
      if (key === "resumes/missing.pdf") throw new Error("ENOENT");
      return Readable.from([Buffer.from("%PDF-1.4 fake")]);
    }),
    put: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  return { getViewer: vi.fn(), withViewer: rls.withViewer, isRecruiter: roles.isRecruiter };
});

import { getViewer, withViewer } from "@hris/auth";
import { GET } from "../app/api/candidates/[id]/resume/route.js";
import { signResumeDownload } from "../lib/sign.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const NORA = "cand-nora"; // applied to job-be, which Raj/Marcus manage and Diego interviews on

// Call the route the way Next would.
const fetchResume = (candidateId, href) =>
  GET(new Request(`http://localhost:3002${href}`), { params: Promise.resolve({ id: candidateId }) });

// A signed link for whoever is currently acting.
const linkFor = (viewer, candidateId = NORA) => signResumeDownload(candidateId, viewer.userId);

beforeEach(async () => {
  await resetDb();
  // Seeded candidates have no résumé (the file only exists once someone applies through the careers
  // page), so give Nora one. Owner-side write through withViewer as Ana — Candidate is RLS'd.
  await withViewer(V.ana, (tx) => tx.$executeRaw`
    UPDATE "Candidate" SET "resumeKey" = 'resumes/nora.pdf', "resumeFileName" = 'nora-adeyemi-cv.pdf'
     WHERE id = ${NORA}`);
});

describe("who can download a CV", () => {
  it("serves it to a recruiter, with the original filename", async () => {
    as(V.raj);
    const res = await fetchResume(NORA, linkFor(V.raj));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("nora-adeyemi-cv.pdf");
    expect(await res.text()).toContain("%PDF");
  });

  it("serves it to an INTERVIEWER — deliberately wider than the offer panel", async () => {
    // The opposite call from M14 on purpose: a résumé is the document the candidate submitted in
    // order to be evaluated, and Diego is the one evaluating them.
    as(V.diego);
    expect((await fetchResume(NORA, linkFor(V.diego))).status).toBe(200);
  });

  it("serves it to the hiring manager", async () => {
    as(V.marcus);
    expect((await fetchResume(NORA, linkFor(V.marcus))).status).toBe(200);
  });

  it("404s for someone off the hiring team — RLS is the real gate", async () => {
    // Priya's link is perfectly signed. It still fails, because app_can_see_candidate returns no row.
    as(V.priya);
    expect((await fetchResume(NORA, linkFor(V.priya))).status).toBe(404);
  });
});

describe("the signature", () => {
  it("401s with no session at all", async () => {
    as(null);
    expect((await fetchResume(NORA, linkFor(V.raj))).status).toBe(401);
  });

  it("403s on a tampered signature", async () => {
    as(V.raj);
    const bad = `/api/candidates/${NORA}/resume?exp=${Date.now() + 60000}&sig=deadbeef`;
    expect((await fetchResume(NORA, bad)).status).toBe(403);
  });

  it("403s on an expired link", async () => {
    as(V.raj);
    const stale = signResumeDownload(NORA, V.raj.userId, Date.now() - 20 * 60 * 1000);
    expect((await fetchResume(NORA, stale)).status).toBe(403);
  });

  it("403s when ANOTHER user replays a valid link", async () => {
    // The point of binding the signature to the user: a link pasted into a shared channel is useless
    // to whoever finds it, even if they'd otherwise be allowed to see the candidate.
    as(V.diego);
    expect((await fetchResume(NORA, linkFor(V.raj))).status).toBe(403);
  });

  it("403s with no signature parameters", async () => {
    as(V.raj);
    expect((await fetchResume(NORA, `/api/candidates/${NORA}/resume`)).status).toBe(403);
  });
});

describe("when there is nothing to serve", () => {
  it("404s for a candidate who never uploaded one", async () => {
    as(V.raj);
    expect((await fetchResume("cand-mei", linkFor(V.raj, "cand-mei"))).status).toBe(404);
  });

  it("404s after an erasure — the résumé dies with the identity", async () => {
    await withViewer(V.ana, (tx) => tx.$queryRaw`SELECT * FROM app_erase_candidate(${NORA}, 'test')`);
    as(V.raj);
    expect((await fetchResume(NORA, linkFor(V.raj))).status).toBe(404);
  });

  it("404s rather than 500s when the DB knows a file the storage layer doesn't", async () => {
    await withViewer(V.ana, (tx) => tx.$executeRaw`
      UPDATE "Candidate" SET "resumeKey" = 'resumes/missing.pdf' WHERE id = ${NORA}`);
    as(V.raj);
    expect((await fetchResume(NORA, linkFor(V.raj))).status).toBe(404);
  });
});
