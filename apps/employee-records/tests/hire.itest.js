import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@hris/database";
import { resetDb } from "../../../test/resetDb.js";
import { withViewer } from "../../../packages/auth/src/rls";

// The hire seam belongs to whoever COMPLETES the hire, so it's tested from employee-records.
// getViewer is mocked per-persona; withViewer is real, so every check is a genuine RLS round-trip.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
  notFound: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email.js", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@hris/auth", async () => {
  const actual = await import("../../../packages/auth/src/index.ts").catch(() => null);
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  const scope = await import("../../../packages/auth/src/scope");
  return {
    ...(actual ?? {}),
    getViewer: vi.fn(),
    withViewer: rls.withViewer,
    canEditEmployee: roles.canEditEmployee,
    canEditCompensation: roles.canEditCompensation,
    getCompContext: scope.getCompContext,
    resolveCompAccess: scope.resolveCompAccess,
  };
});

import { getViewer } from "@hris/auth";
import { createEmployee } from "../app/employees/[id]/actions.ts";
import { getOnboardingQueue, getHireForPrefill } from "../lib/queries.ts";

const ORG = "10000000-0000-0000-0000-000000000001";
const DEPT_ENG = "20000000-0000-0000-0000-000000000002";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);

// Mark an application HIRED — the ATS decision, not what this milestone tests. Runs as Ana
// (HR_ADMIN), the one persona that satisfies BOTH app_can_manage_job and canEditEmployee; a bare
// prisma client would be silently blocked by RLS, since it carries no app.current_* session vars.
const markHired = (id) =>
  withViewer(V.ana, (tx) =>
    tx.$executeRaw`UPDATE "Application" SET stage = 'HIRED', "hiredEmployeeId" = NULL WHERE id = ${id}`,
  );

// Mirrors the real form, including the hidden applicationId the onboarding-queue link supplies.
const hireForm = (over = {}) => {
  const f = new FormData();
  const v = {
    applicationId: "app-luis",
    firstName: "Luis", lastName: "Romero", email: "luis.romero@frogsatwork.test",
    hireDate: "2026-09-01", departmentId: DEPT_ENG, jobTitle: "Senior Backend Engineer",
    employmentType: "FULL_TIME", role: "EMPLOYEE",
    emergencyContactName: "Ana Romero", emergencyContactRelationship: "Sister",
    emergencyContactPhone: "+1 555 0199",
    ...over,
  };
  for (const [k, val] of Object.entries(v)) if (val !== undefined) f.set(k, String(val));
  return f;
};

// createEmployee redirects on success; capture the new employee id from the thrown NEXT_REDIRECT.
async function create(form) {
  try {
    const res = await createEmployee({}, form);
    return { error: res?.error };
  } catch (e) {
    if (e.__redirect) return { employeeId: e.message.match(/\/employees\/(.+)$/)?.[1] };
    throw e;
  }
}

// Read-backs also need a viewer — Application and Job are both RLS'd.
const appRow = (id) =>
  withViewer(V.ana, (tx) => tx.$queryRaw`SELECT stage::text, "hiredEmployeeId" FROM "Application" WHERE id = ${id}`);
const jobRow = (id) =>
  withViewer(V.ana, (tx) => tx.$queryRaw`SELECT status::text, openings FROM "Job" WHERE id = ${id}`);

beforeEach(async () => {
  await resetDb();
});

describe("the onboarding queue", () => {
  it("lists hired candidates with no employee record yet", async () => {
    await markHired("app-luis");
    as(V.ana);
    const q = await getOnboardingQueue();
    expect(q).toHaveLength(1);
    expect(q[0].name).toBe("Luis Romero");
    expect(q[0].jobTitle).toBe("Senior Backend Engineer");
  });

  it("is empty for a hiring manager — visibility follows capability, not just RLS", async () => {
    // Marcus IS on job-be's hiring team, so RLS alone would show him this. He can't create employees,
    // so the queue is gated on canEditEmployee instead.
    await markHired("app-luis");
    as(V.marcus);
    expect(await getOnboardingQueue()).toHaveLength(0);
  });

  it("prefill returns null for an application that isn't hired", async () => {
    as(V.ana);
    expect(await getHireForPrefill("app-nora")).toBeNull(); // still APPLIED
  });
});

describe("completing a hire", () => {
  it("HR_GENERALIST can complete it — the case that needs the doorway", async () => {
    // Bianca may create employees but has NO write access to "Application" (app_can_manage_job
    // excludes HR_GENERALIST). Without app_link_hire this test fails at the link step.
    await markHired("app-luis");
    as(V.bianca);

    const res = await create(hireForm());
    expect(res.employeeId).toBeTruthy();

    const [app] = await appRow("app-luis");
    expect(app.hiredEmployeeId).toBe(res.employeeId);

    // And the employee is a real, complete record — history v1 + audit, as usual.
    const [hist] = await withViewer(V.ana, (tx) => tx.$queryRaw`
      SELECT version, "jobTitle" FROM "EmployeeHistory" WHERE "employeeId" = ${res.employeeId}`);
    expect(hist.version).toBe(1);
    expect(hist.jobTitle).toBe("Senior Backend Engineer");
  });

  it("HR_ADMIN can complete it too", async () => {
    await markHired("app-luis");
    as(V.ana);
    const res = await create(hireForm());
    expect(res.employeeId).toBeTruthy();
    const [app] = await appRow("app-luis");
    expect(app.hiredEmployeeId).toBe(res.employeeId);
  });

  it("a RECRUITER cannot — canEditEmployee refuses before anything is written", async () => {
    await markHired("app-luis");
    as(V.raj);
    const res = await create(hireForm());
    expect(res.error).toBeTruthy();
    const [app] = await appRow("app-luis");
    expect(app.hiredEmployeeId).toBeNull();
  });

  it("creating an employee WITHOUT an application still works (the normal path)", async () => {
    as(V.ana);
    const res = await create(hireForm({ applicationId: undefined, email: "walkin@frogsatwork.test" }));
    expect(res.employeeId).toBeTruthy();
  });
});

describe("the requisition lifecycle", () => {
  it("stays OPEN while openings remain, then FILLS and leaves the public careers page", async () => {
    // job-be has 2 openings.
    const [before] = await jobRow("job-be");
    expect(before.openings).toBe(2);

    await markHired("app-luis");
    as(V.ana);
    await create(hireForm());
    const [afterOne] = await jobRow("job-be");
    expect(afterOne.status).toBe("OPEN"); // one hire, two openings

    await markHired("app-nora");
    const second = await create(
      hireForm({ applicationId: "app-nora", firstName: "Nora", lastName: "Adeyemi", email: "nora.a@frogsatwork.test" }),
    );
    expect(second.employeeId).toBeTruthy();
    const [afterTwo] = await jobRow("job-be");
    expect(afterTwo.status).toBe("FILLED");

    // Filling the req removes it from the public careers page for free.
    const publicJobs = await prisma.$queryRaw`SELECT id FROM app_public_jobs()`;
    expect(publicJobs.map((j) => j.id)).not.toContain("job-be");
  });
});

describe("the doorway itself", () => {
  it("refuses to link an application that isn't HIRED", async () => {
    const [r] = await withViewer(V.ana, (tx) =>
      tx.$queryRaw`SELECT app_link_hire('app-nora', ${V.marcus.employeeId}) AS result`,
    );
    expect(r.result).toBe("NOT_HIRED");
  });

  it("is idempotent — a second link reports ALREADY_LINKED and changes nothing", async () => {
    await markHired("app-luis");
    const first = await withViewer(V.ana, (tx) =>
      tx.$queryRaw`SELECT app_link_hire('app-luis', ${V.marcus.employeeId}) AS result`,
    );
    expect(first[0].result).toBe("OK");
    const second = await withViewer(V.ana, (tx) =>
      tx.$queryRaw`SELECT app_link_hire('app-luis', ${V.raj.employeeId}) AS result`,
    );
    expect(second[0].result).toBe("ALREADY_LINKED");
    const [app] = await appRow("app-luis");
    expect(app.hiredEmployeeId).toBe(V.marcus.employeeId); // the first link stands
  });

  it("refuses a RECRUITER even though they CAN write Application rows", async () => {
    await markHired("app-luis");
    const [r] = await withViewer(V.raj, (tx) =>
      tx.$queryRaw`SELECT app_link_hire('app-luis', ${V.marcus.employeeId}) AS result`,
    );
    expect(r.result).toBe("FORBIDDEN");
  });

  it("is the ONLY way through: a direct UPDATE from HR_GENERALIST is still refused", async () => {
    await markHired("app-luis");
    const updated = await withViewer(V.bianca, (tx) =>
      tx.application.updateMany({ where: { id: "app-luis" }, data: { hiredEmployeeId: V.marcus.employeeId } }),
    );
    expect(updated.count).toBe(0);
  });
});
