import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("../lib/i18n.js");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en", getTimeZone: async () => "America/Mexico_City" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  const scope = await import("../../../packages/auth/src/scope");
  return {
    getViewer: vi.fn(),
    withViewer: rls.withViewer,
    isHrRole: roles.isHrRole,
    getSubtreeIds: scope.getSubtreeIds,
  };
});

import { getViewer, withViewer } from "@hris/auth";
import { adjustTimesheet, saveTimesheetDraft } from "../app/timesheets/actions.js";
import { getTeamTimesheets, getTeamMemberTimesheet } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
};
const TOM_WEEK = "2026-07-13"; // Tom's seeded SUBMITTED sheet (44h)
const asHr = (fn) => withViewer(V.ana, fn);

function entriesForm(entries) {
  const fd = new FormData();
  fd.set("entries", JSON.stringify(entries));
  return fd;
}
async function run(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e.__redirect) return { redirect: e.message };
    throw e;
  }
}
const adjust = (empId, week, entries) => run(adjustTimesheet(empId, week, undefined, entriesForm(entries)));
const tomSheet = () =>
  asHr((tx) => tx.timesheet.findUnique({ where: { employeeId_periodStart: { employeeId: V.tom.employeeId, periodStart: new Date(TOM_WEEK) } }, include: { entries: true } }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("getTeamTimesheets (roster)", () => {
  it("a manager sees their reports (not themselves) with the week's status; an employee gets null", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const team = await getTeamTimesheets(TOM_WEEK);
    const ids = team.rows.map((r) => r.employeeId);
    expect(ids).toContain(V.tom.employeeId);
    expect(ids).not.toContain(V.marcus.employeeId); // never yourself
    const tom = team.rows.find((r) => r.employeeId === V.tom.employeeId);
    expect(tom.status).toBe("SUBMITTED");
    expect(tom.total).toBe(44);
    expect(tom.overtime).toBe(4);

    getViewer.mockResolvedValue(V.diego);
    expect(await getTeamTimesheets(TOM_WEEK)).toBeNull();
  });
});

describe("getTeamMemberTimesheet (gated view)", () => {
  it("a manager views a report's sheet (adjustable when submitted); an employee gets null", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const view = await getTeamMemberTimesheet(V.tom.employeeId, TOM_WEEK);
    expect(view.employee.employeeNumber).toBe("E-0006");
    expect(view.timesheet.status).toBe("SUBMITTED");
    expect(view.timesheet.adjustable).toBe(true);
    expect(view.timesheet.entries).toHaveLength(5);
    expect(view.projects.map((p) => p.id)).toContain("proj-mob"); // Tom's assigned project

    getViewer.mockResolvedValue(V.diego);
    expect(await getTeamMemberTimesheet(V.tom.employeeId, TOM_WEEK)).toBeNull();
  });
});

describe("adjustTimesheet", () => {
  it("a manager adjusts a submitted sheet → persists, stays SUBMITTED, audits TIMESHEET_ADJUST", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const res = await adjust(V.tom.employeeId, TOM_WEEK, [
      { workDate: "2026-07-13", hours: 9, projectId: "proj-mob" },
      { workDate: "2026-07-14", hours: 8 },
    ]);
    expect(res.ok).toBe(true);

    const sheet = await tomSheet();
    expect(sheet.status).toBe("SUBMITTED"); // adjust never changes status
    expect(sheet.entries).toHaveLength(2);
    const total = sheet.entries.reduce((s, e) => s + Number(e.hours), 0);
    expect(total).toBe(17);
    expect(sheet.entries.find((e) => Number(e.hours) === 9).projectId).toBe("proj-mob");

    const audit = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.tom.employeeId, eventType: "TIMESHEET_ADJUST" } }));
    expect(audit).toBe(1);
  });

  it("rejects a project the TARGET isn't assigned to, a non-SUBMITTED sheet, and a non-manager", async () => {
    // proj-plat: Tom is NOT assigned (Diego/Priya are).
    getViewer.mockResolvedValue(V.marcus);
    expect((await adjust(V.tom.employeeId, TOM_WEEK, [{ workDate: "2026-07-13", hours: 8, projectId: "proj-plat" }])).error).toBeTruthy();

    // A DRAFT sheet can't be adjusted: Diego saves a draft, then Marcus tries to adjust it.
    getViewer.mockResolvedValue(V.diego);
    await run(saveTimesheetDraft("2026-07-20", undefined, entriesForm([{ workDate: "2026-07-20", hours: 8 }])));
    getViewer.mockResolvedValue(V.marcus);
    expect((await adjust(V.diego.employeeId, "2026-07-20", [{ workDate: "2026-07-20", hours: 6 }])).error).toBeTruthy();

    // An employee cannot adjust anyone.
    getViewer.mockResolvedValue(V.diego);
    expect((await adjust(V.tom.employeeId, TOM_WEEK, [{ workDate: "2026-07-13", hours: 8 }])).error).toBeTruthy();
  });
});
