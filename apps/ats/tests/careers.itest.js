import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// The public surface has NO viewer at all, so unlike the other ATS suites there's no getViewer
// persona to set for the apply path — that's the point. withViewer is still real, used only to read
// results back as a recruiter and prove the data landed correctly under RLS.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]) }));
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

import { withViewer } from "@hris/auth";
import { prisma } from "@hris/database";
import { submitApplication } from "../app/careers/actions.js";
import { getPublishedJobs, getPublishedJob } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const RAJ = { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG };
const SYSTEM_USER = "00000000-0000-0000-0000-000000000001";

const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const APPLICANT = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 555 0000" };

// The action redirects on success; treat a thrown NEXT_REDIRECT as "accepted".
async function apply(jobId, form = APPLICANT) {
  try {
    const res = await submitApplication(jobId, undefined, fd(form));
    return res ?? {};
  } catch (e) {
    if (e.__redirect) return { ok: true };
    throw e;
  }
}
const asRaj = (fn) => withViewer(RAJ, fn);

beforeEach(async () => {
  await resetDb();
});

describe("public job listing", () => {
  it("shows only OPEN + published reqs, with no internal columns", async () => {
    const jobs = await getPublishedJobs();
    expect(jobs.map((j) => j.title).sort()).toEqual(["Product Designer", "Senior Backend Engineer"]);
    // Nothing internal leaks through the SECURITY DEFINER projection.
    for (const key of ["openings", "departmentId", "createdById", "status", "orgId"]) {
      expect(jobs[0]).not.toHaveProperty(key);
    }
  });

  it("hides a req that is OPEN but not published", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { publishedAt: null } }));
    expect((await getPublishedJobs()).map((j) => j.title)).toEqual(["Senior Backend Engineer"]);
    expect(await getPublishedJob("job-pd")).toBeNull(); // direct URL reveals nothing either
  });

  it("hides a published req once it stops being OPEN", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { status: "PAUSED" } }));
    expect(await getPublishedJob("job-pd")).toBeNull();
  });
});

describe("anonymous application submission", () => {
  it("accepts an application from someone with no account at all", async () => {
    expect((await apply("job-be")).ok).toBe(true);

    const cand = await asRaj((tx) => tx.candidate.findFirst({ where: { email: "ada@example.com" } }));
    expect(cand).not.toBeNull();
    expect(cand.firstName).toBe("Ada");

    const app = await asRaj((tx) => tx.application.findFirst({ where: { candidateId: cand.id, jobId: "job-be" } }));
    expect(app.stage).toBe("APPLIED");

    // The append-only trail starts attributed to the SYSTEM actor (an applicant has no User row).
    const events = await asRaj((tx) => tx.applicationEvent.findMany({ where: { applicationId: app.id } }));
    expect(events).toHaveLength(1);
    expect(events[0].toStage).toBe("APPLIED");
    expect(events[0].actorId).toBe(SYSTEM_USER);
  });

  it("refuses an unpublished job even when the id is known (no enumeration)", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { publishedAt: null } }));
    const res = await apply("job-pd");
    expect(res.error).toBeTruthy();
    expect(await asRaj((tx) => tx.candidate.findFirst({ where: { email: "ada@example.com" } }))).toBeNull();
  });

  it("refuses a job that isn't OPEN", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { status: "CLOSED" } }));
    expect((await apply("job-pd")).error).toBeTruthy();
  });

  it("refuses a second application to the same job, without creating a duplicate", async () => {
    await apply("job-be");
    const res = await apply("job-be");
    expect(res.error).toBeTruthy();
    const apps = await asRaj((tx) =>
      tx.application.findMany({ where: { jobId: "job-be", candidate: { email: "ada@example.com" } } }),
    );
    expect(apps).toHaveLength(1);
  });

  it("reuses the same person across two different reqs (the talent pool)", async () => {
    await apply("job-be");
    await apply("job-pd");
    const cands = await asRaj((tx) => tx.candidate.findMany({ where: { email: "ada@example.com" } }));
    expect(cands).toHaveLength(1); // one person…
    const apps = await asRaj((tx) => tx.application.findMany({ where: { candidateId: cands[0].id } }));
    expect(apps).toHaveLength(2); // …two applications
  });

  it("never overwrites an existing candidate's details", async () => {
    // Nora is seeded with a known email; give her a phone on file first.
    await asRaj((tx) =>
      tx.candidate.update({ where: { id: "cand-nora" }, data: { phone: "+1 555 0100" } }),
    );
    await apply("job-be", { ...APPLICANT, firstName: "Not", lastName: "Nora", email: "nora.adeyemi@example.com", phone: "+99 HACKED" });

    const nora = await asRaj((tx) => tx.candidate.findUnique({ where: { id: "cand-nora" } }));
    expect(nora.phone).toBe("+1 555 0100"); // unchanged
    expect(nora.firstName).toBe("Nora"); // unchanged
  });

  it("silently discards a honeypot submission", async () => {
    const res = await apply("job-be", { ...APPLICANT, website: "http://spam.example" });
    expect(res.ok).toBe(true); // the bot is told nothing
    expect(await asRaj((tx) => tx.candidate.findFirst({ where: { email: "ada@example.com" } }))).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect((await apply("job-be", { ...APPLICANT, email: "not-an-email" })).error).toBeTruthy();
  });
});

describe("RLS still governs the resulting data", () => {
  it("a public application is visible to the hiring team but not to an outsider", async () => {
    await apply("job-be");
    const forRecruiter = await asRaj((tx) => tx.candidate.findMany({ where: { email: "ada@example.com" } }));
    expect(forRecruiter).toHaveLength(1);

    // With no session variables at all, the same read returns nothing — the public write path did
    // not weaken RLS for ordinary queries.
    const anonymous = await prisma.candidate.findMany({ where: { email: "ada@example.com" } });
    expect(anonymous).toHaveLength(0);
  });
});
