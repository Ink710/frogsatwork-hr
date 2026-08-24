import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// Same harness as board.itest.js: request-scoped Next APIs mocked, getViewer stubbed per persona,
// but withViewer is REAL so every assertion below is a genuine RLS round-trip.
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

import { getViewer } from "@hris/auth";
import { getCandidates, getCandidateProfile, getCandidateFilterOptions } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const names = (res) => res.rows.map((r) => r.name).sort();

beforeEach(async () => {
  await resetDb();
});

describe("candidate database — RLS scoping", () => {
  it("a recruiter sees every candidate in the org", async () => {
    as(V.raj);
    const res = await getCandidates();
    expect(res.total).toBe(4);
    expect(names(res)).toEqual(["Luis Romero", "Mei Tanaka", "Nora Adeyemi", "Owen Zhang"]);
  });

  it("a hiring manager sees only candidates who applied to their req", async () => {
    as(V.marcus);
    // Marcus is on job-be only. All 4 seeded candidates applied there, so he sees 4 — but crucially
    // he can still only reach them THROUGH that job (see the profile test below).
    expect((await getCandidates()).total).toBe(4);
  });

  it("someone on no hiring team sees nobody", async () => {
    as(V.priya);
    expect((await getCandidates()).total).toBe(0);
  });
});

describe("search + filters", () => {
  it("token-AND search matches across first and last name", async () => {
    as(V.raj);
    expect(names(await getCandidates({ q: "Mei Tanaka" }))).toEqual(["Mei Tanaka"]);
    expect(names(await getCandidates({ q: "tanaka" }))).toEqual(["Mei Tanaka"]); // case-insensitive
    expect((await getCandidates({ q: "nobody here" })).total).toBe(0);
  });

  it("searches email too", async () => {
    as(V.raj);
    expect(names(await getCandidates({ q: "luis.romero@example.com" }))).toEqual(["Luis Romero"]);
  });

  it("filters by stage, job, and source", async () => {
    as(V.raj);
    expect(names(await getCandidates({ stage: "OFFER" }))).toEqual(["Luis Romero"]);
    expect(names(await getCandidates({ jobId: "job-pd" }))).toEqual(["Owen Zhang"]);
    // M1: source matches an APPLICATION, not the person's first touch. M2: the value is a campaign
    // SLUG. Owen's first touch is Referral, but he came back through the LinkedIn grads push — so
    // that campaign's filter must find him and the plain `linkedin` one must not.
    expect(names(await getCandidates({ source: "linkedin" }))).toEqual(["Nora Adeyemi"]);
    expect(names(await getCandidates({ source: "linkedin-march-grads" }))).toEqual(["Owen Zhang"]);
  });

  it("ANDs source with the other application filters INSIDE one application", async () => {
    // Owen has linkedin-march-grads @ SCREEN (backend) and referral @ REJECTED (design). Neither is
    // both, so this must find nobody. If `source` were pushed as its own `some` clause it would
    // match him — one application satisfying the source, a DIFFERENT one satisfying the stage —
    // which is the same cross-application confusion the stage/job/date filters already guard
    // against, and the exact class of error this milestone set out to remove.
    as(V.raj);
    expect(names(await getCandidates({ source: "linkedin-march-grads", stage: "REJECTED" }))).toEqual([]);
    // The combination that IS true of a single application still matches.
    expect(names(await getCandidates({ source: "linkedin-march-grads", stage: "SCREEN" }))).toEqual(["Owen Zhang"]);
  });

  it("filters by applied-date range, with an INCLUSIVE upper bound", async () => {
    as(V.raj);
    // Seeded appliedAt: Luis 2026-07-10, Mei 07-20, Owen(be) 07-28, Nora 08-05, Owen(pd) 06-15.
    expect(names(await getCandidates({ appliedFrom: "2026-08-01" }))).toEqual(["Nora Adeyemi"]);
    // Upper bound must include the whole day of 2026-07-10 (Luis applied at 12:00 that day).
    expect(names(await getCandidates({ appliedTo: "2026-07-10" }))).toEqual(["Luis Romero", "Owen Zhang"]);
    expect(names(await getCandidates({ appliedFrom: "2026-07-15", appliedTo: "2026-07-28" }))).toEqual([
      "Mei Tanaka",
      "Owen Zhang",
    ]);
  });

  it("combines application filters within ONE application, not across different ones", async () => {
    as(V.raj);
    // Owen has TWO applications: job-be at SCREEN, and job-pd at REJECTED.
    // "job-pd AND stage=SCREEN" must NOT match him — no single application satisfies both.
    expect((await getCandidates({ jobId: "job-pd", stage: "SCREEN" })).total).toBe(0);
    // …while the pairs that DO co-occur on one application still match.
    expect(names(await getCandidates({ jobId: "job-pd", stage: "REJECTED" }))).toEqual(["Owen Zhang"]);
    expect(names(await getCandidates({ jobId: "job-be", stage: "SCREEN" }))).toEqual(["Owen Zhang"]);
  });

  it("reports the newest application on each row, and counts the rest", async () => {
    as(V.raj);
    const owen = (await getCandidates({ q: "owen" })).rows[0];
    expect(owen.applicationCount).toBe(2);
    expect(owen.latest.jobTitle).toBe("Senior Backend Engineer"); // 07-28 beats the 06-15 design one
    expect(owen.latest.stage).toBe("SCREEN");
  });
});

describe("pagination", () => {
  it("clamps an out-of-range page to the last one", async () => {
    as(V.raj);
    const res = await getCandidates({ page: 99 });
    expect(res.page).toBe(res.pageCount); // 4 candidates < one page → clamps to 1
    expect(res.total).toBe(4);
  });
});

describe("candidate profile", () => {
  it("shows a person's FULL cross-job history", async () => {
    as(V.raj);
    const owen = (await getCandidates({ q: "owen" })).rows[0];
    const profile = await getCandidateProfile(owen.id);
    expect(profile.applications).toHaveLength(2);
    expect(profile.applications.map((a) => a.job.title)).toEqual([
      "Senior Backend Engineer", // newest first
      "Product Designer",
    ]);
    expect(profile.applications[1].stage).toBe("REJECTED");
  });

  it("hides a candidate entirely from someone with no access", async () => {
    as(V.raj);
    const owen = (await getCandidates({ q: "owen" })).rows[0];
    as(V.priya);
    expect(await getCandidateProfile(owen.id)).toBeNull();
  });

  it("scopes a hiring manager's view to their own req's applications", async () => {
    as(V.raj);
    const owen = (await getCandidates({ q: "owen" })).rows[0];
    as(V.marcus); // on job-be only — must not see Owen's design-req application
    const profile = await getCandidateProfile(owen.id);
    expect(profile.applications.map((a) => a.job.title)).toEqual(["Senior Backend Engineer"]);
  });
});

describe("filter options", () => {
  it("are RLS-scoped to what the viewer can see", async () => {
    as(V.raj);
    const forRecruiter = await getCandidateFilterOptions();
    expect(forRecruiter.jobs).toHaveLength(2);
    // M2: campaigns, not free-text sources — and the ARCHIVED one is absent, because a campaign
    // that can no longer receive applications would only ever filter to nothing.
    expect(forRecruiter.campaigns.map((c) => c.slug)).toEqual([
      "careers-page",
      "linkedin",
      "linkedin-march-grads",
      "referral",
    ]);

    as(V.marcus);
    expect((await getCandidateFilterOptions()).jobs.map((j) => j.title)).toEqual(["Senior Backend Engineer"]);
  });
});
