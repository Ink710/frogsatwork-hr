import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// Same harness as the other ATS suites: request-scoped Next APIs mocked, getViewer stubbed per
// persona, withViewer REAL so every check is a genuine RLS round-trip. `redirect` throws (as it does
// in Next) so a successful createJob is observable by catching the thrown NEXT_REDIRECT.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
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
import {
  createJob,
  updateJob,
  setJobStatus,
  addRound,
  removeRound,
  addJobMember,
  removeJobMember,
} from "../app/(internal)/jobs/actions.js";
import { getJobForManage, getAssignableEmployees } from "../lib/queries.js";

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
const JOB_FORM = { title: "Staff Frontend Engineer", employmentType: "FULL_TIME", openings: "2" };

// createJob redirects on success; capture the new id from the thrown NEXT_REDIRECT.
async function createAndGetId(form = JOB_FORM) {
  try {
    const res = await createJob(undefined, fd(form));
    return { error: res?.error };
  } catch (e) {
    if (e.__redirect) return { id: e.message.match(/\/jobs\/([^/]+)\/manage/)?.[1] };
    throw e;
  }
}

beforeEach(async () => {
  await resetDb();
});

describe("createJob", () => {
  it("lets a recruiter open a req, as a DRAFT, with themselves on the hiring team", async () => {
    as(V.raj);
    const { id } = await createAndGetId();
    expect(id).toBeTruthy();

    const { job } = await getJobForManage(id);
    expect(job.title).toBe("Staff Frontend Engineer");
    expect(job.status).toBe("DRAFT"); // opening it is a deliberate second step
    expect(job.openings).toBe(2);
    // Auto-membership: the creator can still manage the req even without the org-wide role.
    expect(job.members).toHaveLength(1);
    expect(job.members[0].role).toBe("RECRUITER");
    expect(job.members[0].employeeId).toBe(V.raj.employeeId);
    // Name resolved structurally (app_org_chart) — a RECRUITER has no employee-records access, so a
    // relation include would have yielded null here.
    expect(job.members[0].name).toBe("Raj Patel");
  });

  it("refuses a plain employee and an interviewer", async () => {
    as(V.priya);
    expect((await createAndGetId()).error).toBeTruthy();
    as(V.diego); // an INTERVIEWER on job-be — still not allowed to OPEN a req
    expect((await createAndGetId()).error).toBeTruthy();
  });

  it("refuses invalid input", async () => {
    as(V.raj);
    expect((await createAndGetId({ ...JOB_FORM, title: "" })).error).toBeTruthy();
  });

  it("keeps a new req invisible to someone off its hiring team", async () => {
    as(V.raj);
    const { id } = await createAndGetId();
    as(V.priya);
    expect(await getJobForManage(id)).toBeNull();
  });
});

describe("updateJob / setJobStatus", () => {
  it("lets the hiring manager edit and open the req", async () => {
    as(V.marcus); // HIRING_MANAGER on job-be
    expect((await updateJob("job-be", undefined, fd({ ...JOB_FORM, title: "Senior Backend Engineer II" }))).ok).toBe(true);
    expect((await setJobStatus("job-be", undefined, fd({ status: "PAUSED" }))).ok).toBe(true);

    as(V.raj);
    const { job } = await getJobForManage("job-be");
    expect(job.title).toBe("Senior Backend Engineer II");
    expect(job.status).toBe("PAUSED");
  });

  it("refuses an interviewer (the RLS read/write split)", async () => {
    as(V.diego);
    expect((await updateJob("job-be", undefined, fd(JOB_FORM))).error).toBeTruthy();
    expect((await setJobStatus("job-be", undefined, fd({ status: "CLOSED" }))).error).toBeTruthy();
  });

  it("rejects an unknown status", async () => {
    as(V.raj);
    expect((await setJobStatus("job-be", undefined, fd({ status: "BOGUS" }))).error).toBeTruthy();
  });
});

describe("interview rounds", () => {
  it("appends new rounds after the existing ones", async () => {
    as(V.raj);
    expect((await addRound("job-be", undefined, fd({ name: "Founder Chat" }))).ok).toBe(true);
    const { job } = await getJobForManage("job-be");
    expect(job.interviewRounds.map((r) => r.name)).toEqual([
      "Technical Screen",
      "System Design",
      "Team Interview",
      "Founder Chat",
    ]);
    expect(job.interviewRounds.at(-1).position).toBe(3);
  });

  it("removing a round leaves a candidate sitting in it intact (SetNull, not orphaned)", async () => {
    as(V.raj);
    // Mei is INTERVIEW at "System Design" (ir-be-design).
    expect((await removeRound("job-be", "ir-be-design", undefined)).ok).toBe(true);

    const mei = await withViewer(V.raj, (tx) => tx.application.findUnique({ where: { id: "app-mei" } }));
    expect(mei.stage).toBe("INTERVIEW"); // still in the pipeline
    expect(mei.currentRoundId).toBeNull(); // just no current round

    // Her history keeps the round NAME, because events store a snapshot rather than a reference.
    const events = await withViewer(V.raj, (tx) =>
      tx.applicationEvent.findMany({ where: { applicationId: "app-mei", roundName: "System Design" } }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("refuses an interviewer", async () => {
    as(V.diego);
    expect((await addRound("job-be", undefined, fd({ name: "Nope" }))).error).toBeTruthy();
  });
});

describe("hiring team", () => {
  it("a recruiter can staff a team by NAME without gaining employee-records access", async () => {
    as(V.raj);
    // The directory (app_org_chart) exposes colleagues structurally…
    const people = await getAssignableEmployees();
    expect(people.length).toBeGreaterThan(1);
    expect(people.some((p) => p.name === "Priya Nair")).toBe(true);

    // …while the recruiter's actual employee-record visibility stays limited to themselves. This is
    // the privacy line the org-chart function exists to hold.
    const visible = await withViewer(V.raj, (tx) => tx.employee.findMany({ select: { id: true } }));
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(V.raj.employeeId);
  });

  it("adds a member, and refuses a duplicate", async () => {
    as(V.raj);
    expect((await addJobMember("job-be", undefined, fd({ employeeId: V.priya.employeeId, role: "INTERVIEWER" }))).ok).toBe(true);
    const dup = await addJobMember("job-be", undefined, fd({ employeeId: V.priya.employeeId, role: "INTERVIEWER" }));
    expect(dup.error).toBeTruthy();
  });

  it("adding someone to the team makes the req visible to them", async () => {
    as(V.raj);
    await addJobMember("job-be", undefined, fd({ employeeId: V.priya.employeeId, role: "INTERVIEWER" }));
    as(V.priya);
    const data = await getJobForManage("job-be");
    expect(data).not.toBeNull(); // she can SEE it now…
    expect(data.canManage).toBe(false); // …but an interviewer still can't manage it
  });

  it("won't remove the last manager-capable member (that would strand the req)", async () => {
    as(V.raj);
    const { job } = await getJobForManage("job-be");
    const managers = job.members.filter((m) => m.role === "RECRUITER" || m.role === "HIRING_MANAGER");
    // Seeded: Raj (RECRUITER) + Marcus (HIRING_MANAGER). Removing one is fine…
    expect((await removeJobMember("job-be", managers[0].id, undefined)).ok).toBe(true);
    // …removing the second must be refused.
    expect((await removeJobMember("job-be", managers[1].id, undefined)).error).toBeTruthy();
  });
});
