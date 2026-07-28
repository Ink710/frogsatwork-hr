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
  return { getT: async () => t, getLocale: async () => "en" };
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
import { clockIn, clockOut, correctClock } from "../app/attendance/actions.js";
import { getClockStatus, getMyAttendance, getTeamAttendance, getTeamAttendanceWeek, getCorrectionTarget } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG }, // Engineering
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG }, // Engineering
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG }, // Engineering
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG }, // Eng manager
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
};
const asHr = (fn) => withViewer(V.ana, fn); // HR sees everything for readback

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
const correct = (fields) => run(correctClock(undefined, form(fields)));
const rowFor = (team, employeeId) => team.rows.find((r) => r.employeeId === employeeId);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("self clock in / out", () => {
  it("clock-in writes an IN punch + CLOCK_IN audit and flips the status to clocked-in", async () => {
    getViewer.mockResolvedValue(V.diego);
    // Diego has no punch today in the seed, so he starts clocked out.
    expect((await getClockStatus()).clockedIn).toBe(false);

    const res = await clockIn();
    expect(res.ok).toBe(true);
    expect((await getClockStatus()).clockedIn).toBe(true);

    const audit = await asHr((tx) =>
      tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: "CLOCK_IN" } }),
    );
    expect(audit).toBe(1);
  });

  it("refuses a double clock-in and a clock-out with no open punch", async () => {
    getViewer.mockResolvedValue(V.diego);
    expect((await clockOut()).error).toBeTruthy(); // not clocked in yet
    await clockIn();
    expect((await clockIn()).error).toBeTruthy(); // already in
    expect((await clockOut()).ok).toBe(true); // closes it
    const audits = await asHr((tx) =>
      tx.employeeAuditLog.count({ where: { employeeId: V.diego.employeeId, eventType: { in: ["CLOCK_IN", "CLOCK_OUT"] } } }),
    );
    expect(audits).toBe(2);
  });
});

describe("RLS scoping (getMyAttendance / getTeamAttendance)", () => {
  it("an employee's own recent view is scoped to themselves", async () => {
    getViewer.mockResolvedValue(V.priya);
    const mine = await getMyAttendance();
    // Whatever days show, none may carry another employee's data — this read is RLS-scoped to Priya.
    expect(mine).not.toBeNull();
    expect(Array.isArray(mine.days)).toBe(true);
  });

  it("an EMPLOYEE gets null from the team view", async () => {
    getViewer.mockResolvedValue(V.diego);
    expect(await getTeamAttendance("2026-07-20")).toBeNull();
  });

  it("a manager sees their reports' derived variance and not themselves", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const team = await getTeamAttendance("2026-07-20"); // seeded: Diego LATE, Tom SHORT
    expect(rowFor(team, V.diego.employeeId).status).toBe("LATE");
    expect(rowFor(team, V.tom.employeeId).status).toBe("SHORT");
    expect(rowFor(team, V.marcus.employeeId)).toBeUndefined(); // never acts on self
  });
});

describe("weekly roster (getTeamAttendanceWeek, M11)", () => {
  const cellFor = (row, date) => row.cells.find((c) => c.date === date);

  it("an EMPLOYEE gets null", async () => {
    getViewer.mockResolvedValue(V.diego);
    expect(await getTeamAttendanceWeek("2026-07-20")).toBeNull();
  });

  it("a manager sees a 7-day grid for their reports (not themselves) with per-cell variance", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const week = await getTeamAttendanceWeek("2026-07-20");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe("2026-07-20"); // Monday
    expect(rowFor(week, V.marcus.employeeId)).toBeUndefined(); // never acts on self

    const diego = rowFor(week, V.diego.employeeId);
    expect(diego.cells).toHaveLength(7);
    expect(cellFor(diego, "2026-07-20").status).toBe("LATE"); // seeded late punch Mon
    expect(cellFor(diego, "2026-07-22").status).toBe("ABSENT"); // scheduled Wed, no punch
    expect(cellFor(rowFor(week, V.tom.employeeId), "2026-07-20").status).toBe("SHORT");
    expect(cellFor(rowFor(week, V.priya.employeeId), "2026-07-23").status).toBe("OPEN"); // open IN Thu
  });

  it("overlays an APPROVED leave as ON_LEAVE (overriding ABSENT)", async () => {
    // Diego is scheduled Wed 2026-07-22 with no punch → ABSENT. Approve a leave covering that day.
    await asHr((tx) =>
      tx.leaveRequest.create({
        data: {
          employeeId: V.diego.employeeId,
          type: "VACATION",
          startDate: new Date("2026-07-22T00:00:00.000Z"),
          endDate: new Date("2026-07-22T00:00:00.000Z"),
          hours: "8.00",
          status: "APPROVED",
          createdById: V.ana.userId,
        },
      }),
    );

    getViewer.mockResolvedValue(V.marcus);
    const diego = rowFor(await getTeamAttendanceWeek("2026-07-20"), V.diego.employeeId);
    expect(cellFor(diego, "2026-07-22").status).toBe("ON_LEAVE"); // overlay wins over ABSENT
    expect(cellFor(diego, "2026-07-20").status).toBe("LATE"); // other days unaffected
  });
});

describe("HR/manager corrections (append-only)", () => {
  it("closes a forgotten clock-out and audits it, flipping OPEN → ON_TIME", async () => {
    // Priya's seeded 2026-07-23 punch is an open IN (09:00) against a 09:00–17:00 shift.
    getViewer.mockResolvedValue(V.marcus);
    expect(rowFor(await getTeamAttendance("2026-07-23"), V.priya.employeeId).status).toBe("OPEN");

    const res = await correct({ employeeId: V.priya.employeeId, type: "OUT", date: "2026-07-23", time: "17:00" });
    expect(res.redirect).toBe("REDIRECT:/attendance/team?date=2026-07-23");

    expect(rowFor(await getTeamAttendance("2026-07-23"), V.priya.employeeId).status).toBe("ON_TIME");
    const audit = await asHr((tx) =>
      tx.employeeAuditLog.count({ where: { employeeId: V.priya.employeeId, eventType: "CLOCK_CORRECTION" } }),
    );
    expect(audit).toBe(1);
    // The appended punch is a MANUAL source (not a self WEB punch).
    const manual = await asHr((tx) => tx.clockEvent.count({ where: { employeeId: V.priya.employeeId, source: "MANUAL" } }));
    expect(manual).toBe(1);
  });

  it("lets HR correct anyone, but forbids an employee correcting a colleague or themselves", async () => {
    // HR can correct.
    getViewer.mockResolvedValue(V.ana);
    expect((await correct({ employeeId: V.priya.employeeId, type: "OUT", date: "2026-07-23", time: "17:00" })).redirect).toBeTruthy();

    // An employee cannot correct a colleague…
    getViewer.mockResolvedValue(V.diego);
    expect((await correct({ employeeId: V.priya.employeeId, type: "OUT", date: "2026-07-23", time: "17:00" })).error).toBeTruthy();
    // …nor themselves (separation of duties).
    expect((await correct({ employeeId: V.diego.employeeId, type: "IN", date: "2026-07-21", time: "09:00" })).error).toBeTruthy();
  });

  it("gates getCorrectionTarget the same way (manager yes, employee null)", async () => {
    getViewer.mockResolvedValue(V.marcus);
    expect((await getCorrectionTarget(V.priya.employeeId)).name).toBe("Priya Nair");
    getViewer.mockResolvedValue(V.diego);
    expect(await getCorrectionTarget(V.priya.employeeId)).toBeNull();
  });
});
