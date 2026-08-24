import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// This app's public surface has NO viewer at all — that is the whole point of it — so unlike the
// other suites there is no getViewer persona to set. withViewer is imported only to make the
// FIXTURE changes below (pausing a req, unpublishing one) as a recruiter would.
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { withViewer } from "@hris/auth";
import { getPublishedJobs, getPublishedJob } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const RAJ = {
  userId: "30000000-0000-0000-0000-000000000008",
  employeeId: "40000000-0000-0000-0000-000000000008",
  role: "RECRUITER",
  orgId: ORG,
};
const asRaj = (fn) => withViewer(RAJ, fn);

beforeEach(async () => {
  await resetDb();
});

describe("the public job listing", () => {
  it("shows only reqs that are OPEN and published", async () => {
    const jobs = await getPublishedJobs();
    expect(jobs.map((j) => j.title).sort()).toEqual(["Product Designer", "Senior Backend Engineer"]);
  });

  it("leaks no internal columns through the doorway", async () => {
    // The projection in app_public_jobs() IS the security boundary — this app does no filtering of
    // its own, so if the function ever grew a column, this is what would catch it.
    const [job] = await getPublishedJobs();
    for (const key of ["openings", "departmentId", "createdById", "status", "orgId", "eeoJobCategory"]) {
      expect(job).not.toHaveProperty(key);
    }
  });

  it("hides a req that is OPEN but not published", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { publishedAt: null } }));
    expect((await getPublishedJobs()).map((j) => j.title)).toEqual(["Senior Backend Engineer"]);
  });

  it("hides a published req once it stops being OPEN", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { status: "PAUSED" } }));
    expect((await getPublishedJobs()).map((j) => j.title)).toEqual(["Senior Backend Engineer"]);
  });
});

describe("a single posting", () => {
  it("returns the description for a live posting", async () => {
    const job = await getPublishedJob("job-be");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job).toHaveProperty("description");
  });

  it("returns null for an unpublished req, so a guessed id is indistinguishable from a wrong one", async () => {
    // The page turns this into notFound(). "Exists but hidden" and "never existed" MUST look the
    // same, or the detail page becomes a way to enumerate unannounced roles.
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { publishedAt: null } }));
    expect(await getPublishedJob("job-pd")).toBeNull();
    expect(await getPublishedJob("does-not-exist")).toBeNull();
  });

  it("returns null for a req that is published but no longer OPEN", async () => {
    await asRaj((tx) => tx.job.update({ where: { id: "job-pd" }, data: { status: "CLOSED" } }));
    expect(await getPublishedJob("job-pd")).toBeNull();
  });
});
