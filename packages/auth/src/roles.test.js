import { describe, it, expect } from "vitest";
import {
  RECORD_SCOPE,
  getRecordScope,
  canViewCompensation,
  canEditEmployee,
  canEditCompensation,
  canTerminate,
  canRehire,
  canViewBudget,
} from "./roles";

// Minimal viewer factory.
const V = (role, extra = {}) => ({ role, employeeId: "self", userId: "u-self", ...extra });

describe("getRecordScope", () => {
  it("HR / payroll / system see ALL", () => {
    for (const r of ["HR_ADMIN", "HR_GENERALIST", "PAYROLL_ADMIN", "SYSTEM"]) {
      expect(getRecordScope(V(r))).toBe(RECORD_SCOPE.ALL);
    }
  });
  it("manager sees SUBTREE, employee sees SELF", () => {
    expect(getRecordScope(V("MANAGER"))).toBe(RECORD_SCOPE.SUBTREE);
    expect(getRecordScope(V("EMPLOYEE"))).toBe(RECORD_SCOPE.SELF);
  });
});

describe("canViewCompensation", () => {
  const target = { id: "t1", departmentId: "d1", depth: 2 };

  it("anyone can see their own pay", () => {
    expect(canViewCompensation(V("EMPLOYEE", { employeeId: "t1" }), target, {})).toBe(true);
  });
  it("payroll sees all comp", () => {
    expect(canViewCompensation(V("PAYROLL_ADMIN"), target, {})).toBe(true);
  });
  it("manager sees comp only within their subtree (downward)", () => {
    expect(canViewCompensation(V("MANAGER"), target, { subtreeIds: new Set(["t1"]) })).toBe(true);
    expect(canViewCompensation(V("MANAGER"), target, { subtreeIds: new Set() })).toBe(false);
  });
  it("employee sees no one else's comp", () => {
    expect(canViewCompensation(V("EMPLOYEE"), target, { subtreeIds: new Set() })).toBe(false);
  });
  it("HR: blocked for superiors and same-dept/same-depth peers, allowed otherwise", () => {
    const ctx = { ancestorIds: new Set(["boss"]), viewerDepth: 2, viewerDeptId: "d1" };
    expect(canViewCompensation(V("HR_ADMIN"), { id: "boss", departmentId: "dX", depth: 0 }, ctx)).toBe(false); // superior
    expect(canViewCompensation(V("HR_ADMIN"), { id: "peer", departmentId: "d1", depth: 2 }, ctx)).toBe(false); // same dept+depth
    expect(canViewCompensation(V("HR_ADMIN"), { id: "other", departmentId: "d2", depth: 2 }, ctx)).toBe(true); // different dept
    expect(canViewCompensation(V("HR_ADMIN"), { id: "sub", departmentId: "d1", depth: 5 }, ctx)).toBe(true); // deeper, same dept
  });
});

describe("write predicates", () => {
  it("canEditEmployee: HR admin + generalist only", () => {
    expect(canEditEmployee(V("HR_ADMIN"))).toBe(true);
    expect(canEditEmployee(V("HR_GENERALIST"))).toBe(true);
    expect(canEditEmployee(V("MANAGER"))).toBe(false);
    expect(canEditEmployee(V("PAYROLL_ADMIN"))).toBe(false);
  });
  it("canEditCompensation: HR admin + payroll only", () => {
    expect(canEditCompensation(V("HR_ADMIN"))).toBe(true);
    expect(canEditCompensation(V("PAYROLL_ADMIN"))).toBe(true);
    expect(canEditCompensation(V("HR_GENERALIST"))).toBe(false);
  });
  it("canTerminate / canRehire: HR admin only", () => {
    expect(canTerminate(V("HR_ADMIN"))).toBe(true);
    expect(canRehire(V("HR_ADMIN"))).toBe(true);
    expect(canTerminate(V("HR_GENERALIST"))).toBe(false);
  });
});

describe("canViewBudget", () => {
  const dept = { id: "dEng", headUserId: "u-marcus" };

  it("HR admin + payroll see every budget", () => {
    expect(canViewBudget(V("HR_ADMIN"), dept, "dOther")).toBe(true);
    expect(canViewBudget(V("PAYROLL_ADMIN"), dept, "dOther")).toBe(true);
  });
  it("HR generalist sees all EXCEPT their own department", () => {
    expect(canViewBudget(V("HR_GENERALIST"), dept, "dPeople")).toBe(true); // not own
    expect(canViewBudget(V("HR_GENERALIST"), dept, "dEng")).toBe(false); // own → hidden
  });
  it("manager sees only their own department (member of, or head of)", () => {
    expect(canViewBudget(V("MANAGER"), dept, "dEng")).toBe(true); // member
    expect(canViewBudget(V("MANAGER", { userId: "u-marcus" }), dept, "dOther")).toBe(true); // head
    expect(canViewBudget(V("MANAGER"), dept, "dOther")).toBe(false); // neither
  });
  it("employee never sees budgets", () => {
    expect(canViewBudget(V("EMPLOYEE"), dept, "dEng")).toBe(false);
  });
});
