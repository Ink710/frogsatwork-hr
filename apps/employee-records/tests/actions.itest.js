import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@hris/database";
import { resetDb } from "../../../test/resetDb.js";

// --- Mock only the thin wrappers; keep all real logic (withViewer, RLS, predicates) ---
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = true;
    throw e;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  const scope = await import("../../../packages/auth/src/scope");
  return {
    getViewer: vi.fn(), // set per test
    withViewer: rls.withViewer,
    getSubtreeIds: scope.getSubtreeIds,
    canEditEmployee: roles.canEditEmployee,
    canEditCompensation: roles.canEditCompensation,
    canTerminate: roles.canTerminate,
    canRehire: roles.canRehire,
  };
});
// Invites send mail via lib/email.js (nodemailer/Mailpit) — stub it so tests never hit SMTP.
vi.mock("@/lib/email.js", () => ({ sendInviteEmail: vi.fn(async () => {}) }));

import { getViewer } from "@hris/auth";
import { withViewer } from "@hris/auth";
import {
  recordChange,
  correctDetails,
  correctMaterial,
  terminateEmployee,
  rehireEmployee,
  createEmployee,
  startStatusChange,
  reinstateEmployee,
  addEmergencyContact,
  deleteEmergencyContact,
  resendInvite,
} from "../app/employees/[id]/actions";
import { setPassword } from "../app/set-password/actions.js";
import { sendInvite, hashInviteToken } from "@/lib/invite.js";
import { sendInviteEmail } from "@/lib/email.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
  priya: { userId: "30000000-0000-0000-0000-000000000005", employeeId: "40000000-0000-0000-0000-000000000005", role: "EMPLOYEE", orgId: ORG },
  nadia: { userId: "30000000-0000-0000-0000-000000000007", employeeId: "40000000-0000-0000-0000-000000000007", role: "PAYROLL_ADMIN", orgId: ORG },
};
const ID = {
  marcus: "40000000-0000-0000-0000-000000000002",
  diego: "40000000-0000-0000-0000-000000000004",
  priya: "40000000-0000-0000-0000-000000000005",
  tom: "40000000-0000-0000-0000-000000000006",
};
// User ids (for the invite/set-password flow, which is keyed on User not Employee).
const USER = {
  ana: "30000000-0000-0000-0000-000000000001",
  diego: "30000000-0000-0000-0000-000000000004",
  priya: "30000000-0000-0000-0000-000000000005",
};
const DEPT_ENG = "20000000-0000-0000-0000-000000000002";
const today = () => new Date().toLocaleDateString("en-CA");

// Run an action; on success it redirects (throws __redirect) → { ok:true }; on failure it
// returns { error }.
async function invoke(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e?.__redirect) return { ok: true };
    throw e;
  }
}

// Assertion helpers read through an HR viewer (sees everything).
const openRows = (empId) =>
  withViewer(V.ana, (tx) => tx.employeeHistory.count({ where: { employeeId: empId, effectiveTo: null } }));
const versionCount = (empId) =>
  withViewer(V.ana, (tx) => tx.employeeHistory.count({ where: { employeeId: empId } }));
const auditCount = (empId, eventType) =>
  withViewer(V.ana, (tx) => tx.employeeAuditLog.count({ where: { employeeId: empId, eventType } }));
const currentVersion = (empId) =>
  withViewer(V.ana, (tx) =>
    tx.employeeHistory.findFirst({ where: { employeeId: empId, effectiveTo: null }, orderBy: { version: "desc" } }));
const employeeRow = (empId) =>
  withViewer(V.ana, (tx) => tx.employee.findUnique({ where: { id: empId } }));

function changeForm(overrides = {}) {
  const fd = new FormData();
  fd.set("jobTitle", "Senior Software Engineer");
  fd.set("employmentType", "FULL_TIME");
  fd.set("departmentId", DEPT_ENG);
  fd.set("effectiveFrom", today());
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
  getViewer.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordChange (effective-dated)", () => {
  it("HR records a title change → new version, one open row, UPDATE audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(recordChange(ID.priya, {}, changeForm()));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(2);
    expect(await openRows(ID.priya)).toBe(1);
    expect(await auditCount(ID.priya, "UPDATE")).toBe(1);
  });

  it("HR_GENERALIST cannot change salary; PAYROLL/HR_ADMIN can", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const denied = await invoke(recordChange(ID.priya, {}, changeForm({ salary: "150000" })));
    expect(denied.error).toMatch(/compensation/i);
    expect(await versionCount(ID.priya)).toBe(1); // nothing written

    getViewer.mockResolvedValue(V.ana);
    const ok = await invoke(recordChange(ID.priya, {}, changeForm({ salary: "150000" })));
    expect(ok.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(2);
  });

  it("rejects a backdated effective date", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(recordChange(ID.priya, {}, changeForm({ effectiveFrom: "2020-01-01" })));
    expect(r.error).toBeTruthy();
    expect(await versionCount(ID.priya)).toBe(1);
  });

  it("rejects a manager reassignment that creates a cycle", async () => {
    getViewer.mockResolvedValue(V.ana);
    // Make Diego (Marcus's report) Marcus's manager → cycle.
    const r = await invoke(recordChange(ID.marcus, {}, changeForm({ managerId: ID.diego })));
    expect(r.error).toMatch(/cycle|reports/i);
  });
});

describe("corrections", () => {
  it("material correction amends in place (no new version) within the window", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("jobTitle", "Software Engineer II");
    const r = await invoke(correctMaterial(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(1); // amended, NOT a new version
    expect(await auditCount(ID.priya, "CORRECTION")).toBe(1);
  });

  it("material correction is rejected once the version ages past the window", async () => {
    // Backdate the open version's createdAt beyond 7 days (owner).
    await withViewer(V.ana, async (tx) => {
      await tx.$executeRaw`UPDATE "EmployeeHistory" SET "createdAt" = now() - interval '10 days'
        WHERE "employeeId" = ${ID.priya} AND "effectiveTo" IS NULL`;
    });
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("jobTitle", "Too Late");
    const r = await invoke(correctMaterial(ID.priya, {}, fd));
    expect(r.error).toMatch(/window/i);
  });

  it("identity correction updates name, no new version, CORRECTION audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("firstName", "Priyanka");
    fd.set("lastName", "Nair");
    fd.set("email", "priya.nair@frogsatwork.test");
    const r = await invoke(correctDetails(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    expect(await versionCount(ID.priya)).toBe(1);
    expect(await auditCount(ID.priya, "CORRECTION")).toBe(1);
  });
});

describe("terminate + rehire", () => {
  function termForm(eligible = true) {
    const fd = new FormData();
    fd.set("terminationDate", today());
    fd.set("terminationReason", "Role eliminated");
    if (eligible) fd.set("eligibleForRehire", "on");
    return fd;
  }

  it("only HR_ADMIN can terminate", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const denied = await invoke(terminateEmployee(ID.priya, {}, termForm()));
    expect(denied.error).toMatch(/authorized/i);
  });

  it("terminate closes the open version; rehire reopens one", async () => {
    getViewer.mockResolvedValue(V.ana);
    expect((await invoke(terminateEmployee(ID.priya, {}, termForm()))).ok).toBe(true);
    expect(await openRows(ID.priya)).toBe(0); // no active version while terminated

    const fd = new FormData();
    fd.set("rehireDate", today());
    expect((await invoke(rehireEmployee(ID.priya, {}, fd))).ok).toBe(true);
    expect(await openRows(ID.priya)).toBe(1); // invariant restored
    expect(await auditCount(ID.priya, "REHIRE")).toBe(1);
  });

  it("rehire is blocked when the employee is not eligible", async () => {
    getViewer.mockResolvedValue(V.ana);
    await invoke(terminateEmployee(ID.priya, {}, termForm(false))); // ineligible
    const fd = new FormData();
    fd.set("rehireDate", today());
    const r = await invoke(rehireEmployee(ID.priya, {}, fd));
    expect(r.error).toMatch(/eligible/i);
  });
});

describe("createEmployee", () => {
  function createForm(overrides = {}) {
    const fd = new FormData();
    fd.set("firstName", "Ada");
    fd.set("lastName", "Lovelace");
    fd.set("email", `ada+${Math.floor(Math.random() * 1e6)}@frogsatwork.test`);
    fd.set("hireDate", today());
    fd.set("departmentId", DEPT_ENG);
    fd.set("jobTitle", "Software Engineer");
    fd.set("employmentType", "FULL_TIME");
    fd.set("role", "EMPLOYEE");
    // Required at hire (the "at least one emergency contact" invariant).
    fd.set("emergencyContactName", "Grace Hopper");
    fd.set("emergencyContactRelationship", "Spouse");
    fd.set("emergencyContactPhone", "+1-555-0100");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }
  // Find a just-created employee by email (through an HR viewer, which sees everyone).
  const findByEmail = (email) =>
    withViewer(V.ana, (tx) =>
      tx.employee.findFirst({
        where: { email },
        select: { id: true, employeeNumber: true, history: { select: { version: true, salary: true, effectiveTo: true } } },
      }),
    );

  it("HR_ADMIN creates an employee with salary → record + v1 + user", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = createForm({ salary: "125000" });
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);

    const emp = await findByEmail(email);
    expect(emp).toBeTruthy();
    expect(emp.employeeNumber).toMatch(/^E-\d{4}$/);
    expect(emp.history).toHaveLength(1);
    expect(emp.history[0].version).toBe(1);
    expect(emp.history[0].effectiveTo).toBeNull(); // exactly one open version
    expect(emp.history[0].salary.toString()).toBe("125000");
  });

  it("HR_GENERALIST creates → salary defaults to 0 (no comp rights)", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const fd = createForm({ salary: "999999" }); // ignored — generalist can't set pay
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);
    const emp = await findByEmail(email);
    expect(emp.history[0].salary.toString()).toBe("0");
  });

  it("a MANAGER cannot create employees", async () => {
    getViewer.mockResolvedValue(V.marcus);
    const r = await invoke(createEmployee({}, createForm()));
    expect(r.error).toMatch(/authorized/i);
  });

  function createForm2(overrides = {}) {
    const fd = new FormData();
    fd.set("firstName", "Ada");
    fd.set("lastName", "Lovelace");
    fd.set("email", `ada+${Math.floor(Math.random() * 1e6)}@frogsatwork.test`);
    fd.set("hireDate", today());
    fd.set("departmentId", DEPT_ENG);
    fd.set("jobTitle", "Software Engineer");
    fd.set("employmentType", "FULL_TIME");
    fd.set("role", "EMPLOYEE");
    fd.set("emergencyContactName", "Grace Hopper");
    fd.set("emergencyContactRelationship", "Spouse");
    fd.set("emergencyContactPhone", "+1-555-0100");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }
  const findFull = (email) =>
    withViewer(V.ana, (tx) => tx.employee.findFirst({ where: { email }, include: { history: true } }));

  it("HR_ADMIN create persists versioned + current-state profile fields", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = createForm2({
      flsaClassification: "NON_EXEMPT", payFrequency: "MONTHLY", salary: "90000", payBasis: "PER_MONTH",
      phone: "+1 555 0001", location: "Remote", workSchedule: "Flexible", timeZone: "America/Denver",
      lastReviewDate: "2025-03-01", equityNote: "None",
    });
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);
    const emp = await findFull(email);
    expect(emp.phone).toBe("+1 555 0001");
    expect(emp.location).toBe("Remote");
    expect(emp.timeZone).toBe("America/Denver");
    expect(emp.equityNote).toBe("None");
    expect(emp.history[0].flsaClassification).toBe("NON_EXEMPT");
    expect(emp.history[0].payFrequency).toBe("MONTHLY");
    expect(emp.history[0].payBasis).toBe("PER_MONTH");
  });

  it("HR_GENERALIST create drops comp-sensitive fields (payBasis, review, equity)", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const fd = createForm2({ payBasis: "PER_MONTH", lastReviewDate: "2025-03-01", equityNote: "Lots" });
    const email = fd.get("email");
    expect((await invoke(createEmployee({}, fd))).ok).toBe(true);
    const emp = await findFull(email);
    expect(emp.lastReviewDate).toBeNull();
    expect(emp.equityNote).toBeNull();
    expect(emp.history[0].payBasis).toBeNull();
  });
});

describe("profile fields (Phase C)", () => {
  it("recordChange persists FLSA + pay frequency into the new version", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(recordChange(ID.priya, {}, changeForm({ flsaClassification: "NON_EXEMPT", payFrequency: "MONTHLY" })));
    expect(r.ok).toBe(true);
    const v = await currentVersion(ID.priya);
    expect(v.version).toBe(2);
    expect(v.flsaClassification).toBe("NON_EXEMPT");
    expect(v.payFrequency).toBe("MONTHLY");
    expect(v.changedFields).toEqual(expect.arrayContaining(["flsaClassification", "payFrequency"]));
  });

  it("payBasis change needs comp rights; FLSA does not", async () => {
    // Generalist: a payBasis change is rejected (comp), leaving nothing written.
    getViewer.mockResolvedValue(V.bianca);
    const denied = await invoke(recordChange(ID.priya, {}, changeForm({ payBasis: "PER_MONTH" })));
    expect(denied.error).toMatch(/compensation/i);
    expect(await versionCount(ID.priya)).toBe(1);
    // But the same generalist CAN flip FLSA (not comp-secret).
    const ok = await invoke(recordChange(ID.priya, {}, changeForm({ flsaClassification: "NON_EXEMPT" })));
    expect(ok.ok).toBe(true);
    expect((await currentVersion(ID.priya)).flsaClassification).toBe("NON_EXEMPT");
  });

  it("correctDetails updates phone without blanking location (formData.has gating)", async () => {
    getViewer.mockResolvedValue(V.ana);
    const before = await employeeRow(ID.priya);
    const fd = new FormData();
    fd.set("firstName", before.firstName);
    fd.set("lastName", before.lastName);
    fd.set("email", before.email);
    fd.set("phone", "+1 999 0000"); // location deliberately NOT submitted
    const r = await invoke(correctDetails(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    const after = await employeeRow(ID.priya);
    expect(after.phone).toBe("+1 999 0000");
    expect(after.location).toBe(before.location); // untouched
    expect(await auditCount(ID.priya, "CORRECTION")).toBe(1);
  });

  it("correctDetails: a non-comp editor cannot change equity", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const before = await employeeRow(ID.priya);
    const fd = new FormData();
    fd.set("firstName", "Priyanka"); // a real change so it isn't "nothing to correct"
    fd.set("lastName", before.lastName);
    fd.set("email", before.email);
    fd.set("equityNote", "Hacked");
    const r = await invoke(correctDetails(ID.priya, {}, fd));
    expect(r.ok).toBe(true);
    const after = await employeeRow(ID.priya);
    expect(after.firstName).toBe("Priyanka"); // name applied
    expect(after.equityNote).toBe(before.equityNote); // equity ignored
  });
});

describe("status changes (leave / suspend / reinstate)", () => {
  function leaveForm(overrides = {}) {
    const fd = new FormData();
    fd.set("type", "LEAVE");
    fd.set("reason", "Parental leave");
    fd.set("startDate", today());
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }
  const openSpan = (empId) =>
    withViewer(V.ana, (tx) =>
      tx.employeeStatusChange.findFirst({ where: { employeeId: empId, endDate: null }, orderBy: { startDate: "desc" } }));

  it("HR places an employee on leave → ON_LEAVE, open span, LEAVE audit, reason not leaked, history untouched", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(startStatusChange(ID.diego, {}, leaveForm()));
    expect(r.ok).toBe(true);
    expect((await employeeRow(ID.diego)).employmentStatus).toBe("ON_LEAVE");
    const span = await openSpan(ID.diego);
    expect(span.type).toBe("LEAVE");
    expect(span.reason).toBe("Parental leave");
    expect(await auditCount(ID.diego, "LEAVE")).toBe(1);
    // The reason must NOT be in the audit JSON — the subject can read their own audit rows.
    const audit = await withViewer(V.ana, (tx) =>
      tx.employeeAuditLog.findFirst({ where: { employeeId: ID.diego, eventType: "LEAVE" } }));
    expect(JSON.stringify(audit.afterState ?? {})).not.toContain("Parental leave");
    expect(await versionCount(ID.diego)).toBe(2); // status isn't versioned — history stays put
  });

  it("HR suspends an active employee → SUSPENDED + SUSPEND audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await invoke(startStatusChange(ID.priya, {}, leaveForm({ type: "SUSPENSION", reason: "Investigation" })));
    expect(r.ok).toBe(true);
    expect((await employeeRow(ID.priya)).employmentStatus).toBe("SUSPENDED");
    expect(await auditCount(ID.priya, "SUSPEND")).toBe(1);
  });

  it("cannot start a status change on a non-active employee", async () => {
    getViewer.mockResolvedValue(V.ana);
    await invoke(startStatusChange(ID.priya, {}, leaveForm()));
    const r = await invoke(startStatusChange(ID.priya, {}, leaveForm())); // already on leave
    expect(r.error).toMatch(/active/i);
  });

  it("HR_GENERALIST cannot change status", async () => {
    getViewer.mockResolvedValue(V.bianca);
    const r = await invoke(startStatusChange(ID.diego, {}, leaveForm()));
    expect(r.error).toMatch(/authorized/i);
    expect((await employeeRow(ID.diego)).employmentStatus).toBe("ACTIVE");
  });

  it("reinstate closes the open span and returns to ACTIVE + REINSTATE audit", async () => {
    getViewer.mockResolvedValue(V.ana);
    await invoke(startStatusChange(ID.diego, {}, leaveForm()));
    const fd = new FormData();
    fd.set("returnDate", today());
    const r = await invoke(reinstateEmployee(ID.diego, {}, fd));
    expect(r.ok).toBe(true);
    expect((await employeeRow(ID.diego)).employmentStatus).toBe("ACTIVE");
    expect(await openSpan(ID.diego)).toBeNull(); // span closed
    expect(await auditCount(ID.diego, "REINSTATE")).toBe(1);
  });

  it("reinstate is rejected when the employee is already active", async () => {
    getViewer.mockResolvedValue(V.ana);
    const fd = new FormData();
    fd.set("returnDate", today());
    const r = await invoke(reinstateEmployee(ID.diego, {}, fd));
    expect(r.error).toMatch(/leave|suspend/i);
  });
});

describe("emergency contacts", () => {
  function contactForm(overrides = {}) {
    const fd = new FormData();
    fd.set("name", "Jordan Doe");
    fd.set("relationship", "Sibling");
    fd.set("phone", "+1-555-0199");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }
  const contacts = (empId) =>
    withViewer(V.ana, (tx) =>
      tx.emergencyContact.findMany({ where: { employeeId: empId }, orderBy: { isPrimary: "desc" } }));

  it("HR adds a contact; the first one is auto-primary", async () => {
    getViewer.mockResolvedValue(V.ana);
    const r = await addEmergencyContact(ID.priya, {}, contactForm()); // priya has none seeded
    expect(r.ok).toBe(true);
    const c = await contacts(ID.priya);
    expect(c).toHaveLength(1);
    expect(c[0].isPrimary).toBe(true);
  });

  it("the employee can manage their own; a manager cannot manage a report's", async () => {
    getViewer.mockResolvedValue(V.priya); // self
    expect((await addEmergencyContact(ID.priya, {}, contactForm())).ok).toBe(true);

    getViewer.mockResolvedValue(V.marcus); // manager of diego — RLS would allow, the app-layer gate blocks
    const denied = await addEmergencyContact(ID.diego, {}, contactForm());
    expect(denied.error).toMatch(/authorized/i);
  });

  it("setting a new primary clears the previous one", async () => {
    getViewer.mockResolvedValue(V.ana);
    await addEmergencyContact(ID.priya, {}, contactForm({ name: "First" })); // auto-primary
    await addEmergencyContact(ID.priya, {}, contactForm({ name: "Second", isPrimary: "on" }));
    const primaries = (await contacts(ID.priya)).filter((x) => x.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe("Second");
  });

  it("cannot delete the last contact; deleting the primary auto-promotes another", async () => {
    getViewer.mockResolvedValue(V.ana);
    const [only] = await contacts(ID.diego); // Diego seeds with exactly one
    expect((await deleteEmergencyContact(only.id, {})).error).toMatch(/at least one/i);

    await addEmergencyContact(ID.diego, {}, contactForm({ name: "Backup" }));
    const primary = (await contacts(ID.diego)).find((x) => x.isPrimary);
    expect((await deleteEmergencyContact(primary.id, {})).ok).toBe(true);
    const remaining = await contacts(ID.diego);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isPrimary).toBe(true); // auto-promoted
  });
});

describe("invite / set-password", () => {
  const makeUnactivated = (userId) =>
    prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: null, inviteTokenHash: null, inviteTokenExpires: null },
    });
  const userRow = (userId) => prisma.user.findUnique({ where: { id: userId } });

  it("sendInvite issues a token + emails an unactivated user; skips an activated one", async () => {
    sendInviteEmail.mockClear();
    await makeUnactivated(USER.diego);
    const res = await sendInvite(USER.diego);
    expect(res.ok).toBe(true);
    const u = await userRow(USER.diego);
    expect(u.inviteTokenHash).toBeTruthy();
    expect(u.invitedAt).toBeTruthy();
    expect(sendInviteEmail).toHaveBeenCalledTimes(1);

    sendInviteEmail.mockClear();
    const skipped = await sendInvite(USER.ana); // seeded users are already activated
    expect(skipped.skipped).toBe(true);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("resendInvite is HR-gated and refuses an already-active account", async () => {
    await makeUnactivated(USER.diego);
    getViewer.mockResolvedValue(V.marcus); // not HR
    expect((await resendInvite(USER.diego)).error).toMatch(/authorized/i);

    getViewer.mockResolvedValue(V.ana);
    expect((await resendInvite(USER.diego)).ok).toBe(true);
    expect((await resendInvite(USER.ana)).error).toMatch(/active/i); // ana already activated
  });

  it("setPassword redeems a valid token once, then the link is dead", async () => {
    const raw = "test-token-abc123";
    await prisma.user.update({
      where: { id: USER.diego },
      data: {
        emailVerifiedAt: null,
        passwordHash: null,
        inviteTokenHash: hashInviteToken(raw),
        inviteTokenExpires: new Date(Date.now() + 3_600_000),
      },
    });
    const fd = new FormData();
    fd.set("token", raw);
    fd.set("password", "s3cretpw!");
    fd.set("confirm", "s3cretpw!");
    expect((await invoke(setPassword({}, fd))).ok).toBe(true);
    const u = await userRow(USER.diego);
    expect(u.passwordHash).toBeTruthy();
    expect(u.emailVerifiedAt).toBeTruthy();
    expect(u.inviteTokenHash).toBeNull(); // burned

    const again = await setPassword({}, fd); // reusing the token now finds nothing
    expect(again.error).toMatch(/invalid|expired/i);
  });

  it("setPassword rejects an expired token and a password mismatch", async () => {
    const raw = "expired-token";
    await prisma.user.update({
      where: { id: USER.diego },
      data: {
        emailVerifiedAt: null,
        inviteTokenHash: hashInviteToken(raw),
        inviteTokenExpires: new Date(Date.now() - 1000),
      },
    });
    const expired = new FormData();
    expired.set("token", raw);
    expired.set("password", "s3cretpw!");
    expired.set("confirm", "s3cretpw!");
    expect((await setPassword({}, expired)).error).toMatch(/invalid|expired/i);

    const mismatch = new FormData();
    mismatch.set("token", raw);
    mismatch.set("password", "s3cretpw!");
    mismatch.set("confirm", "different");
    expect((await setPassword({}, mismatch)).error).toBeTruthy();
  });
});
