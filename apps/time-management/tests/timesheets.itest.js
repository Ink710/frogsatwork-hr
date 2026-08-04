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
import { saveTimesheetDraft, submitTimesheet, approveTimesheet, rejectTimesheet } from "../app/timesheets/actions.js";
import { getCurrentTimesheet, getPendingTimesheets } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG }, // NON_EXEMPT
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG }, // EXEMPT
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG }, // Tom is in his subtree
};
// Tom's seeded SUBMITTED timesheet (week 2026-07-13; 44h → 4h daily OT).
const TS_TOM = "ts-tom-0713";

const WEEK = "2026-07-27"; // a Monday, empty in the seed
// Mon 10 + Tue–Fri 8 = 42h → daily OT 2 (for NON_EXEMPT), 0 for EXEMPT.
const ENTRIES = [
  { workDate: "2026-07-27", hours: 10 },
  { workDate: "2026-07-28", hours: 8 },
  { workDate: "2026-07-29", hours: 8 },
  { workDate: "2026-07-30", hours: 8 },
  { workDate: "2026-07-31", hours: 8 },
];

function form(entries) {
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
const saveDraft = (ws, entries) => run(saveTimesheetDraft(ws, undefined, form(entries)));
const submit = (ws, entries) => run(submitTimesheet(ws, undefined, form(entries)));
const asHr = (fn) => withViewer(V.ana, fn);
const findSheet = (employeeId) =>
  asHr((tx) => tx.timesheet.findUnique({ where: { employeeId_periodStart: { employeeId, periodStart: new Date(WEEK) } }, include: { entries: true } }));

function noteForm(note) {
  const fd = new FormData();
  if (note != null) fd.set("decisionNote", note);
  return fd;
}
const approveTs = (id, note) => run(approveTimesheet(id, undefined, noteForm(note)));
const rejectTs = (id, note) => run(rejectTimesheet(id, undefined, noteForm(note)));
const findById = (id) => asHr((tx) => tx.timesheet.findUnique({ where: { id } }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("saveTimesheetDraft / submitTimesheet", () => {
  it("saves a DRAFT with the week's non-zero entries", async () => {
    getViewer.mockResolvedValue(V.tom);
    const res = await saveDraft(WEEK, ENTRIES);
    expect(res.redirect).toBe("REDIRECT:/timesheets");

    const sheet = await findSheet(V.tom.employeeId);
    expect(sheet.status).toBe("DRAFT");
    expect(sheet.entries).toHaveLength(5);
    expect(sheet.periodEnd.toISOString().slice(0, 10)).toBe("2026-08-02"); // Sunday
  });

  it("submits (audited) and derives California overtime for a NON_EXEMPT employee", async () => {
    getViewer.mockResolvedValue(V.tom);
    await submit(WEEK, ENTRIES);

    const sheet = await findSheet(V.tom.employeeId);
    expect(sheet.status).toBe("SUBMITTED");
    expect(sheet.submittedAt).toBeTruthy();
    const audit = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.tom.employeeId, eventType: "TIMESHEET_SUBMIT" } }));
    expect(audit).toBe(1);

    const current = await getCurrentTimesheet(WEEK);
    expect(current.hours.total).toBe(42);
    expect(current.hours.overtime).toBe(2); // one 10h day → 2h daily OT
  });

  it("gives an EXEMPT employee no overtime for the same hours", async () => {
    getViewer.mockResolvedValue(V.diego); // EXEMPT
    await saveDraft(WEEK, ENTRIES);
    const current = await getCurrentTimesheet(WEEK);
    expect(current.hours.total).toBe(42);
    expect(current.hours.overtime).toBe(0);
  });

  it("won't let a submitted timesheet be edited", async () => {
    getViewer.mockResolvedValue(V.tom);
    await submit(WEEK, ENTRIES);
    const res = await saveDraft(WEEK, [{ workDate: "2026-07-27", hours: 5 }]);
    expect(res.error).toMatch(/already submitted/i);
  });

  it("keeps a timesheet invisible to another employee (RLS)", async () => {
    getViewer.mockResolvedValue(V.tom);
    await submit(WEEK, ENTRIES);
    // Diego (an unrelated employee) sees none of Tom's timesheets.
    const count = await withViewer(V.diego, (tx) => tx.timesheet.count({ where: { employeeId: V.tom.employeeId } }));
    expect(count).toBe(0);
  });
});

describe("approveTimesheet / rejectTimesheet", () => {
  it("a manager approves a report's submitted timesheet → APPROVED + audit", async () => {
    getViewer.mockResolvedValue(V.marcus); // Tom is in Marcus's subtree
    const res = await approveTs(TS_TOM, "Looks right");
    expect(res.redirect).toBe("REDIRECT:/approvals");

    const ts = await findById(TS_TOM);
    expect(ts.status).toBe("APPROVED");
    expect(ts.reviewedById).toBe(V.marcus.userId);
    const audit = await asHr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.tom.employeeId, eventType: "TIMESHEET_APPROVE" } }));
    expect(audit).toBe(1);
  });

  it("an employee cannot approve a timesheet (not even their own)", async () => {
    getViewer.mockResolvedValue(V.tom);
    const res = await approveTs(TS_TOM);
    expect(res.error).toBeTruthy();
    expect((await findById(TS_TOM)).status).toBe("SUBMITTED");
  });

  it("rejecting reopens the timesheet for editing", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const res = await rejectTs(TS_TOM, "Please split the Friday hours");
    expect(res.redirect).toBe("REDIRECT:/approvals");
    expect((await findById(TS_TOM)).status).toBe("REJECTED");

    // Tom sees that week as editable again (REJECTED → editable).
    getViewer.mockResolvedValue(V.tom);
    const current = await getCurrentTimesheet("2026-07-13");
    expect(current.status).toBe("REJECTED");
    expect(current.editable).toBe(true);
  });
});

describe("getPendingTimesheets", () => {
  it("a manager sees their reports' submitted timesheets with derived overtime", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const queue = await getPendingTimesheets();
    const tom = queue.find((s) => s.id === TS_TOM);
    expect(tom).toBeTruthy();
    expect(tom.total).toBe(44);
    expect(tom.overtime).toBe(4); // two 10h days → 4h daily OT (Tom is NON_EXEMPT)
  });
  it("an employee gets an empty queue", async () => {
    getViewer.mockResolvedValue(V.tom);
    expect(await getPendingTimesheets()).toEqual([]);
  });
});

describe("project tagging (M8)", () => {
  it("persists a projectId the employee is assigned to", async () => {
    getViewer.mockResolvedValue(V.tom); // seeded: assigned to proj-mob
    const res = await saveDraft(WEEK, [{ workDate: WEEK, hours: 8, projectId: "proj-mob" }]);
    expect(res.redirect).toBe("REDIRECT:/timesheets");
    const sheet = await findSheet(V.tom.employeeId);
    expect(sheet.entries[0].projectId).toBe("proj-mob");
  });

  it("rejects a projectId the employee is NOT assigned to", async () => {
    getViewer.mockResolvedValue(V.tom); // NOT assigned to proj-plat (Diego/Priya are)
    expect((await saveDraft(WEEK, [{ workDate: WEEK, hours: 8, projectId: "proj-plat" }])).error).toBeTruthy();
  });
});

describe("meeting tagging (M10)", () => {
  it("persists a meetingId the employee is assigned to", async () => {
    getViewer.mockResolvedValue(V.tom); // seeded: assigned to mtg-kickstart
    const res = await saveDraft(WEEK, [{ workDate: WEEK, hours: 0.5, meetingId: "mtg-kickstart" }]);
    expect(res.redirect).toBe("REDIRECT:/timesheets");
    const sheet = await findSheet(V.tom.employeeId);
    expect(sheet.entries[0].meetingId).toBe("mtg-kickstart");
    expect(sheet.entries[0].projectId).toBeNull();
  });

  it("rejects a meetingId the employee is NOT assigned to", async () => {
    getViewer.mockResolvedValue(V.tom); // NOT assigned to mtg-eng-sync (Diego/Priya are)
    expect((await saveDraft(WEEK, [{ workDate: WEEK, hours: 1, meetingId: "mtg-eng-sync" }])).error).toBeTruthy();
  });

  it("rejects a line tagged to both a project and a meeting", async () => {
    getViewer.mockResolvedValue(V.tom);
    expect((await saveDraft(WEEK, [{ workDate: WEEK, hours: 8, projectId: "proj-mob", meetingId: "mtg-kickstart" }])).error).toBeTruthy();
  });

  it("sums a project line + a meeting line on the same day for daily overtime (line-items)", async () => {
    getViewer.mockResolvedValue(V.tom); // NON_EXEMPT
    // Monday: 9h project work + 0.5h meeting = 9.5h that day → 1.5h daily OT.
    const res = await saveDraft(WEEK, [
      { workDate: WEEK, hours: 9, projectId: "proj-mob" },
      { workDate: WEEK, hours: 0.5, meetingId: "mtg-kickstart" },
    ]);
    expect(res.redirect).toBe("REDIRECT:/timesheets");
    const sheet = await findSheet(V.tom.employeeId);
    expect(sheet.entries).toHaveLength(2); // two lines on the same day, both persisted

    const current = await getCurrentTimesheet(WEEK);
    expect(current.hours.total).toBe(9.5);
    expect(current.hours.overtime).toBe(1.5);
  });
});
