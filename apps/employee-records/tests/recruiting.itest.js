import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@hris/database";
import { withViewer } from "../../../packages/auth/src/rls";

// ATS (recruiting) RLS round-trips. Lives here (rather than in @hris/recruiting) because it exercises
// the DATABASE — @hris/database + withViewer resolve from employee-records' deps, and the `integration`
// vitest project migrates + seeds hris_test before running. The @hris/recruiting package is pure
// (zod + rules), unit-tested on its own; the access model it fronts is proven here.
//
// Seeded ids — see packages/database/src/seed.js (section 16):
//   Raj (RECRUITER) manages the backend req; Marcus is its HIRING_MANAGER; Diego is an INTERVIEWER;
//   Priya is a plain EMPLOYEE with no hiring-team membership.
const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ATS RLS — per-job hiring-team scoping", () => {
  it("a recruiter sees every job, application, and candidate in the org", async () => {
    const r = await withViewer(V.raj, async (tx) => ({
      jobs: await tx.job.count(),
      apps: await tx.application.count(),
      cands: await tx.candidate.count(),
    }));
    expect(r).toEqual({ jobs: 2, apps: 4, cands: 4 });
  });

  it("a hiring manager sees only their own req's pipeline (not the other job)", async () => {
    const r = await withViewer(V.marcus, async (tx) => ({
      jobs: await tx.job.count(),
      apps: await tx.application.count(),
      cands: await tx.candidate.count(),
    }));
    // job-be only (Marcus isn't on the DRAFT job-pd), but all 4 of its applications + candidates.
    expect(r).toEqual({ jobs: 1, apps: 4, cands: 4 });
  });

  it("an employee with no hiring-team membership sees nothing", async () => {
    const r = await withViewer(V.priya, async (tx) => ({
      jobs: await tx.job.count(),
      apps: await tx.application.count(),
      cands: await tx.candidate.count(),
    }));
    expect(r).toEqual({ jobs: 0, apps: 0, cands: 0 });
  });

  it("an interviewer can READ the pipeline but not WRITE to it", async () => {
    const jobs = await withViewer(V.diego, (tx) => tx.job.count());
    expect(jobs).toBe(1); // reads the req he interviews for

    // Interviewers are excluded from app_can_manage_job → the INSERT violates the write policy.
    await expect(
      withViewer(V.diego, (tx) =>
        tx.application.create({
          data: { orgId: ORG, jobId: "job-be", candidateId: "cand-nora", stage: "APPLIED" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("a hiring manager CAN record a pipeline event on their req", async () => {
    const ev = await withViewer(V.marcus, (tx) =>
      tx.applicationEvent.create({
        data: { applicationId: "app-nora", jobId: "job-be", fromStage: "APPLIED", toStage: "SCREEN", actorId: V.marcus.userId },
      }),
    );
    expect(ev.toStage).toBe("SCREEN");
  });
});

describe("ATS ApplicationEvent is append-only for the app role", () => {
  it("hris_app may INSERT but not UPDATE/DELETE ApplicationEvent", async () => {
    const [priv] = await prisma.$queryRaw`
      SELECT
        has_table_privilege(current_user, '"ApplicationEvent"', 'INSERT') AS can_insert,
        has_table_privilege(current_user, '"ApplicationEvent"', 'UPDATE') AS can_update,
        has_table_privilege(current_user, '"ApplicationEvent"', 'DELETE') AS can_delete`;
    expect(priv.can_insert).toBe(true);
    expect(priv.can_update).toBe(false);
    expect(priv.can_delete).toBe(false);
  });
});
