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
// `source` is the campaign slug a tracking link would carry (M2); undefined means an untracked
// visit, which the action falls back to the built-in `careers-page` campaign for.
async function apply(jobId, form = APPLICANT, source) {
  try {
    const res = await submitApplication(jobId, source ?? null, undefined, fd(form));
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

describe("campaign attribution on the public path (M2)", () => {
  const readApp = (email) =>
    asRaj((tx) =>
      tx.application.findFirst({
        where: { candidate: { email } },
        select: { source: true, campaignId: true, campaign: { select: { slug: true, channel: true } } },
      }),
    );

  it("attributes a tracked link to its campaign", async () => {
    await apply("job-be", APPLICANT, "linkedin-march-grads");
    const app = await readApp("ada@example.com");
    expect(app.campaign.slug).toBe("linkedin-march-grads");
    expect(app.campaign.channel).toBe("LINKEDIN");
    // The snapshot is the campaign's name at submit time, not the slug.
    expect(app.source).toBe("LinkedIn — March grads");
  });

  it("falls back to the careers-page campaign for an untracked visit", async () => {
    await apply("job-be");
    const app = await readApp("ada@example.com");
    expect(app.campaign.slug).toBe("careers-page");
  });

  // ── THE SECURITY PROPERTY THIS MILESTONE EXISTS FOR ────────────────────────────────────────────
  it("DISCARDS an unrecognised slug instead of recording it, and still accepts the application", async () => {
    // Before M2 this string would have been written verbatim into a report that deliberately
    // survives erasure. Note the application is still ACCEPTED: attribution is our bookkeeping
    // problem, and a mangled link must never cost someone a job.
    const res = await apply("job-be", APPLICANT, "competitor-smear-campaign");
    expect(res.ok).toBe(true);

    const app = await readApp("ada@example.com");
    expect(app.campaignId).toBeNull();
    expect(app.source).toBeNull();
  });

  it("refuses an ARCHIVED campaign's slug — a retired link stops crediting", async () => {
    const res = await apply("job-be", APPLICANT, "facebook-spring");
    expect(res.ok).toBe(true);
    const app = await readApp("ada@example.com");
    expect(app.campaignId).toBeNull();
  });

  it("never lets a slug from another org attribute an application", async () => {
    // The org is derived from the JOB inside app_submit_application, never from the caller, so a
    // valid-looking slug belonging to someone else's org simply doesn't resolve.
    const otherOrg = "20000000-0000-0000-0000-000000000002";
    await prisma.$executeRaw`
      INSERT INTO "Organization" (id, name, "createdAt") VALUES (${otherOrg}, 'Other Co', now())
      ON CONFLICT (id) DO NOTHING`;
    // Created THROUGH the other org's own session, not as a bare client — campaign_write refuses an
    // insert with no session variables, which is the policy doing its job rather than a test detail.
    await withViewer(
      { userId: SYSTEM_USER, employeeId: null, role: "RECRUITER", orgId: otherOrg },
      (tx) =>
        tx.campaign.create({
          data: {
            name: "Foreign push",
            slug: "foreign-push",
            channel: "FACEBOOK",
            orgId: otherOrg,
            createdById: SYSTEM_USER,
          },
        }),
    );

    await apply("job-be", APPLICANT, "foreign-push");
    const app = await readApp("ada@example.com");
    expect(app.campaignId).toBeNull();
  });

  it("sets FIRST TOUCH from the resolved campaign, not from raw input", async () => {
    await apply("job-be", APPLICANT, "linkedin-march-grads");
    const cand = await asRaj((tx) =>
      tx.candidate.findFirst({ where: { email: "ada@example.com" }, select: { source: true } }),
    );
    expect(cand.source).toBe("LinkedIn — March grads");
  });
});
