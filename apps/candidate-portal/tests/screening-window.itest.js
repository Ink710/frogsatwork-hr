import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { getMyApplications } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

// ⚠️ Resolve the account via the candidate_id the DOORWAY returns, never by joining "Candidate" —
// that table is under RLS and this connection has no session variables, so a join matches nothing.
async function accountFor(email) {
  const [issued] = await prisma.$queryRaw`
    SELECT result, candidate_id
    FROM app_issue_candidate_login(${email}, ${`h-${email}`}, (now() + interval '30 min')::timestamp(3))`;
  const row = await prisma.candidateAccount.findUnique({
    where: { candidateId: issued.candidate_id },
    select: { id: true },
  });
  return row.id;
}

const setWindow = (jobId, data) => asAna((tx) => tx.job.update({ where: { id: jobId }, data }));

const WINDOW = {
  screeningCallFrom: "09:00",
  screeningCallTo: "17:00",
  screeningCallTimeZone: "America/Mexico_City",
};

const setStage = (appId, stage) =>
  asAna((tx) => tx.application.update({ where: { id: appId }, data: { stage } }));

const appById = (rows, id) => rows.find((a) => a.id === id);

beforeEach(async () => {
  await resetDb();
});

describe("the screening call window an applicant is shown", () => {
  it("appears while the application is at SCREEN", async () => {
    await setWindow("job-be", WINDOW);
    await setStage("app-owen", "SCREEN");

    const rows = await getMyApplications(await accountFor("owen.zhang@example.com"));
    expect(appById(rows, "app-owen").callWindow).toEqual({
      from: "09:00",
      to: "17:00",
      timeZone: "America/Mexico_City",
    });
  });

  /**
   * ⚠️ THE CASE THE WHOLE GATE EXISTS FOR, and it carries its own control: the req HAS a window
   * configured throughout, so a null here means the doorway withheld it rather than there being
   * nothing to withhold. Both assertions run against the same job in the same test for that reason.
   */
  it("is withheld at every other stage, even though the req has one set", async () => {
    await setWindow("job-be", WINDOW);
    const account = await accountFor("owen.zhang@example.com");

    for (const stage of ["APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"]) {
      await setStage("app-owen", stage);
      const rows = await getMyApplications(account);
      expect(appById(rows, "app-owen").callWindow, `stage ${stage}`).toBeNull();
    }

    // CONTROL: the identical call at SCREEN does return it, so the nulls above are the gate.
    await setStage("app-owen", "SCREEN");
    const rows = await getMyApplications(account);
    expect(appById(rows, "app-owen").callWindow).not.toBeNull();
  });

  // ⚠️ The window is CLEARED explicitly rather than assumed absent: the seed ships one on job-be so
  // the portal notice is demonstrable, and a test that relied on the seed being empty here would
  // have started passing for the wrong reason the moment the demo data changed.
  it("is null when the req has no window, so the portal shows nothing", async () => {
    await setWindow("job-be", {
      screeningCallFrom: null,
      screeningCallTo: null,
      screeningCallTimeZone: null,
    });
    await setStage("app-owen", "SCREEN");
    const rows = await getMyApplications(await accountFor("owen.zhang@example.com"));
    expect(appById(rows, "app-owen").callWindow).toBeNull();
  });

  // A window is per-req, so one applicant at SCREEN on two reqs is told two different things —
  // and must not be told anything about the req that has set none.
  it("is per requisition, not per person", async () => {
    await setWindow("job-be", WINDOW);
    await setWindow("job-pd", {
      screeningCallFrom: "08:30",
      screeningCallTo: "16:30",
      screeningCallTimeZone: "Europe/Madrid",
    });
    await setStage("app-owen", "SCREEN");
    await setStage("app-owen-pd", "SCREEN");

    const rows = await getMyApplications(await accountFor("owen.zhang@example.com"));
    expect(appById(rows, "app-owen").callWindow.timeZone).toBe("America/Mexico_City");
    expect(appById(rows, "app-owen-pd").callWindow.timeZone).toBe("Europe/Madrid");
  });

  // Sessions are stateless JWTs, so the data layer is the only place revocation can bite — the
  // same property M5 established for the rest of this doorway.
  it("is unreachable through a closed account or an erased candidate", async () => {
    await setWindow("job-be", WINDOW);
    await setStage("app-owen", "SCREEN");
    const account = await accountFor("owen.zhang@example.com");
    expect(await getMyApplications(account)).not.toHaveLength(0); // control

    await prisma.candidateAccount.update({ where: { id: account }, data: { closedAt: new Date() } });
    expect(await getMyApplications(account)).toHaveLength(0);

    await prisma.candidateAccount.update({ where: { id: account }, data: { closedAt: null } });
    await asAna((tx) =>
      tx.candidate.updateMany({
        where: { email: "owen.zhang@example.com" },
        data: { anonymisedAt: new Date() },
      }),
    );
    expect(await getMyApplications(account)).toHaveLength(0);
  });
});
