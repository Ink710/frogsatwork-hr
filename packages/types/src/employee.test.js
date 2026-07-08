import { describe, it, expect } from "vitest";
import {
  employeeChangeSchema,
  employeeCreateSchema,
  materialCorrectionSchema,
  terminationSchema,
  isWithinCorrectionWindow,
  CORRECTION_WINDOW_DAYS,
} from "./employee.js";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

describe("employeeChangeSchema", () => {
  const base = { jobTitle: "Engineer", employmentType: "FULL_TIME", departmentId: "d1" };

  it("accepts a valid change effective today", () => {
    const r = employeeChangeSchema.safeParse({ ...base, salary: "120000", effectiveFrom: today() });
    expect(r.success).toBe(true);
    expect(r.data.effectiveFrom).toBeInstanceOf(Date);
  });
  it("rejects a backdated effective date (anti-forgery)", () => {
    const r = employeeChangeSchema.safeParse({ ...base, effectiveFrom: "2020-01-01" });
    expect(r.success).toBe(false);
  });
  it("rejects malformed salary (money must be a clean decimal string)", () => {
    for (const bad of ["12.345", "1,200", "abc", "-5"]) {
      expect(employeeChangeSchema.safeParse({ ...base, salary: bad, effectiveFrom: today() }).success).toBe(false);
    }
  });
  it("rejects an unknown employment type", () => {
    expect(
      employeeChangeSchema.safeParse({ ...base, employmentType: "SLAVERY", effectiveFrom: today() }).success,
    ).toBe(false);
  });
});

describe("employeeCreateSchema", () => {
  const base = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@peoplebase.test",
    hireDate: today(),
    departmentId: "d1",
    jobTitle: "Engineer",
    employmentType: "FULL_TIME",
    // Every new hire requires an emergency contact ("at least one at all times" invariant).
    emergencyContactName: "Grace Hopper",
    emergencyContactRelationship: "Spouse",
    emergencyContactPhone: "+1-555-0100",
  };
  it("accepts valid input and defaults role to EMPLOYEE", () => {
    const r = employeeCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data.role).toBe("EMPLOYEE");
    expect(r.data.hireDate).toBeInstanceOf(Date);
  });
  it("rejects a bad email", () => {
    expect(employeeCreateSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
  it("rejects a missing employment type", () => {
    const { employmentType, ...rest } = base;
    expect(employeeCreateSchema.safeParse(rest).success).toBe(false);
  });
  it("requires an emergency contact (the hire-time invariant)", () => {
    const { emergencyContactName, ...rest } = base;
    expect(employeeCreateSchema.safeParse(rest).success).toBe(false);
  });
});

describe("materialCorrectionSchema", () => {
  it("all fields optional (any subset is valid)", () => {
    expect(materialCorrectionSchema.safeParse({}).success).toBe(true);
    expect(materialCorrectionSchema.safeParse({ jobTitle: "New title" }).success).toBe(true);
  });
  it("still validates salary format when present", () => {
    expect(materialCorrectionSchema.safeParse({ salary: "90000.00" }).success).toBe(true);
    expect(materialCorrectionSchema.safeParse({ salary: "9.999" }).success).toBe(false);
  });
});

describe("terminationSchema", () => {
  it("requires a reason and a non-past date", () => {
    expect(terminationSchema.safeParse({ terminationDate: today(), terminationReason: "Layoff", eligibleForRehire: true }).success).toBe(true);
    expect(terminationSchema.safeParse({ terminationDate: today(), terminationReason: "", eligibleForRehire: true }).success).toBe(false);
    expect(terminationSchema.safeParse({ terminationDate: "2020-01-01", terminationReason: "x", eligibleForRehire: false }).success).toBe(false);
  });
});

describe("isWithinCorrectionWindow", () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
  it(`is ${CORRECTION_WINDOW_DAYS} days`, () => {
    expect(CORRECTION_WINDOW_DAYS).toBe(7);
  });
  it("recent entries are correctable, old ones are locked", () => {
    expect(isWithinCorrectionWindow(daysAgo(2))).toBe(true);
    expect(isWithinCorrectionWindow(daysAgo(10))).toBe(false);
  });
});
