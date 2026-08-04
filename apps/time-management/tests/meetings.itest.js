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
import { createMeeting, assignToMeeting, unassignFromMeeting, toggleMeetingStatus } from "../app/meetings/actions.js";
import { getManagedMeetings, getMyMeetings, getMeetingForManage, getWeekMeetings } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  // Bianca's row is in People & Culture — a plain EMPLOYEE OUTSIDE Marcus's Engineering subtree.
  peopleEmp: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "EMPLOYEE", orgId: ORG },
  // Tom is seeded assigned to mtg-kickstart only (not mtg-eng-sync).
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG },
};
const asMgr = (fn) => withViewer(V.marcus, fn);

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.set(k, String(v));
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
const create = (fields) => run(createMeeting(undefined, form(fields)));
const meetingByName = (name) => asMgr((tx) => tx.meeting.findFirst({ where: { name } }));
const standup = { name: "Daily Standup", dayOfWeek: 2, startTime: "09:00", endTime: "09:15" };

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("createMeeting / getManagedMeetings", () => {
  it("a manager creates a meeting they own; an employee cannot", async () => {
    getViewer.mockResolvedValue(V.marcus);
    expect((await create(standup)).redirect).toBe("REDIRECT:/meetings");
    const m = await meetingByName("Daily Standup");
    expect(m.createdById).toBe(V.marcus.userId);
    expect(m.status).toBe("ACTIVE");
    expect(m.dayOfWeek).toBe(2);
    expect(m.startTime).toBe("09:00");

    const managed = await getManagedMeetings();
    expect(managed.map((x) => x.name)).toContain("Daily Standup");

    getViewer.mockResolvedValue(V.diego);
    expect((await create({ ...standup, name: "Sneaky" })).error).toBeTruthy();
    expect(await getManagedMeetings()).toBeNull(); // employee: no management view
  });

  it("rejects an invalid weekday / time window", async () => {
    getViewer.mockResolvedValue(V.marcus);
    expect((await create({ ...standup, dayOfWeek: 9 })).error).toBeTruthy();
    expect((await create({ ...standup, startTime: "10:00", endTime: "09:00" })).error).toBeTruthy();
  });
});

describe("assignments + the employee picker", () => {
  it("a manager assigns a report; the report sees it in their picker; a non-report is rejected", async () => {
    getViewer.mockResolvedValue(V.marcus);
    await create(standup);
    const meeting = await meetingByName("Daily Standup");

    // Assign Diego (subtree) → ok; Diego's picker now includes it.
    expect((await assignToMeeting(meeting.id, undefined, form({ employeeId: V.diego.employeeId }))).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyMeetings()).map((x) => x.id)).toContain(meeting.id);

    // A manager cannot assign an employee outside their subtree (RLS WITH CHECK backstop).
    getViewer.mockResolvedValue(V.marcus);
    expect((await assignToMeeting(meeting.id, undefined, form({ employeeId: V.peopleEmp.employeeId }))).error).toBeTruthy();
    // Duplicate assignment is refused.
    expect((await assignToMeeting(meeting.id, undefined, form({ employeeId: V.diego.employeeId }))).error).toBeTruthy();
  });

  it("archiving a meeting drops it from the picker but keeps the assignment; unassign removes it", async () => {
    getViewer.mockResolvedValue(V.marcus);
    await create(standup);
    const meeting = await meetingByName("Daily Standup");
    await assignToMeeting(meeting.id, undefined, form({ employeeId: V.diego.employeeId }));

    // Archive → Diego's ACTIVE-only picker no longer shows it.
    expect((await toggleMeetingStatus(meeting.id, undefined)).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyMeetings()).map((x) => x.id)).not.toContain(meeting.id);

    // Reactivate + unassign.
    getViewer.mockResolvedValue(V.marcus);
    await toggleMeetingStatus(meeting.id, undefined);
    const detail = await getMeetingForManage(meeting.id);
    const assignmentId = detail.assignees.find((a) => a.employeeId === V.diego.employeeId).assignmentId;
    expect((await unassignFromMeeting(meeting.id, assignmentId, undefined)).ok).toBe(true);
    getViewer.mockResolvedValue(V.diego);
    expect((await getMyMeetings()).map((x) => x.id)).not.toContain(meeting.id);
  });
});

describe("getWeekMeetings (timesheet suggestions, M10)", () => {
  it("maps an assigned meeting onto its weekday in the week, with its duration", async () => {
    // Seeded: Diego is assigned to mtg-kickstart (Monday 09:00–09:30) + mtg-eng-sync (Wed 14:00–15:00).
    getViewer.mockResolvedValue(V.diego);
    const week = "2026-07-27"; // a Monday
    const suggestions = await getWeekMeetings(week);

    const kickstart = suggestions.find((s) => s.meetingId === "mtg-kickstart");
    expect(kickstart).toBeTruthy();
    expect(kickstart.workDate).toBe("2026-07-27"); // Monday of the week
    expect(kickstart.suggestedHours).toBe(0.5); // 09:00–09:30

    const sync = suggestions.find((s) => s.meetingId === "mtg-eng-sync");
    expect(sync.workDate).toBe("2026-07-29"); // Wednesday
    expect(sync.suggestedHours).toBe(1); // 14:00–15:00
  });

  it("excludes meetings the employee isn't assigned to", async () => {
    getViewer.mockResolvedValue(V.tom); // assigned to mtg-kickstart only
    const suggestions = await getWeekMeetings("2026-07-27");
    expect(suggestions.map((s) => s.meetingId)).toContain("mtg-kickstart");
    expect(suggestions.map((s) => s.meetingId)).not.toContain("mtg-eng-sync");
  });
});

describe("getMeetingForManage scoping", () => {
  it("HR manages any meeting; a manager only their own; candidates are RLS-scoped", async () => {
    getViewer.mockResolvedValue(V.marcus);
    await create(standup);
    const meeting = await meetingByName("Daily Standup");
    const mgrView = await getMeetingForManage(meeting.id);
    expect(mgrView.candidates.map((c) => c.id)).toContain(V.diego.employeeId);
    expect(mgrView.candidates.map((c) => c.id)).not.toContain(V.peopleEmp.employeeId); // out of subtree

    // An employee gets null; HR sees it.
    getViewer.mockResolvedValue(V.diego);
    expect(await getMeetingForManage(meeting.id)).toBeNull();
    getViewer.mockResolvedValue(V.ana);
    expect((await getMeetingForManage(meeting.id)).meeting.name).toBe("Daily Standup");
  });
});
