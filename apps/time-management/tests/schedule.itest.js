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
import { createShift, publishWeek, requestSwap, approveSwap } from "../app/schedule/actions.js";
import { getWeekSchedule, getPendingSwaps } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG }, // Engineering
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG }, // Eng manager
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG }, // Engineering
  // Bianca's employee row is in People & Culture; here we treat her as a plain EMPLOYEE to test
  // cross-department visibility (she must NOT see the Engineering schedule).
  peopleEmp: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "EMPLOYEE", orgId: ORG },
};
const asMgr = (fn) => withViewer(V.marcus, fn); // Marcus sees the Engineering schedule + his reports
const WEEK = "2026-07-20"; // the seeded published Engineering week (7 shifts)

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
const create = (fields) => run(createShift(undefined, form(fields)));
const countShifts = (sch) => sch.days.reduce((n, d) => n + d.shifts.length, 0);
const reqSwap = (fields) => run(requestSwap(undefined, form(fields)));
const approveSwapA = (id, note) => run(approveSwap(id, undefined, form({ decisionNote: note })));
const shiftIdOf = (employeeId) => asMgr((tx) => tx.shift.findFirst({ where: { employeeId }, orderBy: { startAt: "asc" }, select: { id: true } })).then((s) => s.id);
const findSwap = (shiftId) => asMgr((tx) => tx.shiftSwapRequest.findFirst({ where: { shiftId } }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("getWeekSchedule (department-published visibility)", () => {
  it("shows a department employee the published schedule (own + peers' + open)", async () => {
    getViewer.mockResolvedValue(V.diego);
    const sch = await getWeekSchedule(WEEK);
    expect(countShifts(sch)).toBe(7); // all seeded Engineering shifts are published
    expect(sch.canManage).toBe(false);
    expect(sch.department.name).toBe("Engineering");
  });

  it("shows an employee in another department nothing", async () => {
    getViewer.mockResolvedValue(V.peopleEmp);
    const sch = await getWeekSchedule(WEEK);
    expect(countShifts(sch)).toBe(0); // People & Culture has no shifts
  });

  it("lets the manager see + manage their department's schedule", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const sch = await getWeekSchedule(WEEK);
    expect(countShifts(sch)).toBe(7);
    expect(sch.canManage).toBe(true);
  });
});

describe("createShift / publishWeek", () => {
  it("adds a DRAFT shift hidden from employees until the week is published", async () => {
    // Manager adds an OPEN draft shift.
    getViewer.mockResolvedValue(V.marcus);
    const res = await create({ date: "2026-07-21", start: "13:00", end: "17:00", role: "Extra cover" });
    expect(res.redirect).toBe("REDIRECT:/schedule?week=2026-07-20");

    // Manager sees it (8, with a draft); an employee does not (still 7 — the open draft is hidden).
    expect((await getWeekSchedule(WEEK)).hasDrafts).toBe(true);
    expect(countShifts(await getWeekSchedule(WEEK))).toBe(8);
    getViewer.mockResolvedValue(V.diego);
    expect(countShifts(await getWeekSchedule(WEEK))).toBe(7);

    // Publish → the employee now sees the published open shift.
    getViewer.mockResolvedValue(V.marcus);
    await run(publishWeek(WEEK, undefined));
    getViewer.mockResolvedValue(V.diego);
    expect(countShifts(await getWeekSchedule(WEEK))).toBe(8);
  });

  it("won't let an employee create a shift", async () => {
    getViewer.mockResolvedValue(V.diego);
    const res = await create({ date: "2026-07-20", start: "09:00", end: "10:00" });
    expect(res.error).toBeTruthy();
  });
});

describe("shift swaps", () => {
  it("an employee requests a swap on their own shift (audited); not on someone else's", async () => {
    getViewer.mockResolvedValue(V.diego);
    const sid = await shiftIdOf(V.diego.employeeId);
    const res = await reqSwap({ shiftId: sid, reason: "Dentist" });
    expect(res.redirect).toBe("REDIRECT:/schedule");

    const swap = await findSwap(sid);
    expect(swap.status).toBe("PENDING");
    expect(swap.requestedByEmployeeId).toBe(V.diego.employeeId);
    expect(swap.targetEmployeeId).toBeNull(); // drop-to-open
    const audit = await asMgr((tx) => tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: "SHIFT_SWAP_REQUEST" } }));
    expect(audit).toBe(1);

    // Can't request a swap for a colleague's shift.
    const priyaShift = await shiftIdOf(V.priya.employeeId);
    const bad = await reqSwap({ shiftId: priyaShift });
    expect(bad.error).toMatch(/your own/i);
  });

  it("a manager approves a DROP → the shift becomes open", async () => {
    getViewer.mockResolvedValue(V.diego);
    const sid = await shiftIdOf(V.diego.employeeId);
    await reqSwap({ shiftId: sid });
    const swap = await findSwap(sid);

    getViewer.mockResolvedValue(V.marcus);
    const res = await approveSwapA(swap.id, "Covered");
    expect(res.redirect).toBe("REDIRECT:/approvals");

    const shift = await asMgr((tx) => tx.shift.findUnique({ where: { id: sid } }));
    expect(shift.employeeId).toBeNull(); // dropped → open
    expect((await asMgr((tx) => tx.shiftSwapRequest.findUnique({ where: { id: swap.id } }))).status).toBe("APPROVED");
  });

  it("a manager approves a SWAP → the shift is reassigned to the colleague", async () => {
    getViewer.mockResolvedValue(V.diego);
    const sid = await shiftIdOf(V.diego.employeeId);
    await reqSwap({ shiftId: sid, targetEmployeeId: V.priya.employeeId });
    const swap = await findSwap(sid);

    getViewer.mockResolvedValue(V.marcus);
    await approveSwapA(swap.id);
    const shift = await asMgr((tx) => tx.shift.findUnique({ where: { id: sid } }));
    expect(shift.employeeId).toBe(V.priya.employeeId);
  });

  it("an employee cannot approve a swap; a manager sees it in the queue", async () => {
    getViewer.mockResolvedValue(V.diego);
    const sid = await shiftIdOf(V.diego.employeeId);
    await reqSwap({ shiftId: sid });
    const swap = await findSwap(sid);

    getViewer.mockResolvedValue(V.diego);
    expect((await approveSwapA(swap.id)).error).toBeTruthy();

    getViewer.mockResolvedValue(V.marcus);
    const queue = await getPendingSwaps();
    expect(queue.map((s) => s.id)).toContain(swap.id);
    expect(queue.find((s) => s.id === swap.id).requester.firstName).toBe("Diego");
  });
});
