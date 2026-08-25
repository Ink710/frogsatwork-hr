import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// The storage driver is mocked at the module boundary rather than writing real files: these tests
// are about WHICH keys get created, kept and deleted, and a temp directory would only add I/O to
// assertions that are entirely about bookkeeping.
const puts = [];
const removes = [];
let removeFails = false;
vi.mock("@hris/storage", () => ({
  createStorage: () => ({
    put: async (key) => {
      puts.push(key);
      return key;
    },
    remove: async (key) => {
      removes.push(key);
      if (removeFails) throw new Error("storage unavailable");
    },
    getStream: async () => {
      throw new Error("not used here");
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = url;
    throw e;
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.11"]]) }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

// The session. Every action resolves the applicant through this and never from the form.
const session = { current: null };
vi.mock("@/lib/auth", () => ({ getApplicant: async () => session.current }));

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { saveProfile, replaceResume, removeResume } from "../app/portal/profile/actions.js";
import { submitApplication } from "../app/jobs/[id]/apply/actions.js";
import { getMyProfile, getMyResume } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

// ⚠️ Resolve the account via the candidate_id the DOORWAY returns, never by joining "Candidate":
// that table is under RLS and this connection has no session variables, so a join matches nothing.
async function accountFor(email) {
  const [issued] = await prisma.$queryRaw`
    SELECT result, candidate_id
    FROM app_issue_candidate_login(${email}, ${`h-${email}`}, (now() + interval '30 min')::timestamp(3))`;
  if (issued?.result !== "OK") return null;
  const row = await prisma.candidateAccount.findUnique({
    where: { candidateId: issued.candidate_id },
    select: { id: true },
  });
  return { accountId: row?.id ?? null, candidateId: issued.candidate_id };
}

const EMPLOYMENT = [
  { employer: "Acme Corp", title: "Engineer", startDate: "2022-01", endDate: "", summary: "Built things" },
];
const EDUCATION = [
  { institution: "State University", qualification: "BSc", startDate: "2016-09", endDate: "2020-06" },
];

function profileForm(o = {}) {
  const f = new FormData();
  const base = {
    firstName: "Nora",
    lastName: "Adeyemi",
    phone: "+44 20 7946 0000",
    employment: JSON.stringify(EMPLOYMENT),
    education: JSON.stringify(EDUCATION),
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) if (v !== undefined) f.set(k, v);
  return f;
}

// ⚠️ A REAL File, not a plain object with the right properties. `FormData.set()` accepts only a
// Blob or a string — anything else is coerced with String(), so a duck-typed stand-in arrives at the
// action as the literal "[object Object]" and every upload silently does nothing. (Written the wrong
// way first; thirteen tests failed identically and none of them were about the code under test.)
function fakeFile({ name = "cv.pdf", type = "application/pdf", size = 1024 } = {}) {
  return new File([new Uint8Array(size)], name, { type });
}

function resumeForm(file = fakeFile()) {
  const f = new FormData();
  f.set("resume", file);
  return f;
}

beforeEach(async () => {
  await resetDb();
  puts.length = 0;
  removes.length = 0;
  removeFails = false;
  session.current = null;
});

describe("the profile editor writes through the doorway", () => {
  it("saves name, phone and both histories for the signed-in applicant", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    const res = await saveProfile(undefined, profileForm({ firstName: "Norah" }));
    expect(res).toEqual({ ok: true });

    const profile = await getMyProfile(nora.accountId);
    expect(profile.firstName).toBe("Norah");
    expect(profile.phone).toBe("+44 20 7946 0000");
    expect(profile.employment.map((e) => e.employer)).toEqual(["Acme Corp"]);
    expect(profile.education.map((e) => e.institution)).toEqual(["State University"]);
  });

  it("replaces the histories wholesale rather than appending", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await saveProfile(undefined, profileForm());
    await saveProfile(
      undefined,
      profileForm({
        employment: JSON.stringify([
          { employer: "Globex", title: "Lead", startDate: "2024-02", endDate: "", summary: "" },
        ]),
      }),
    );

    const profile = await getMyProfile(nora.accountId);
    expect(profile.employment.map((e) => e.employer)).toEqual(["Globex"]);
  });

  it("clears a history when an empty list is submitted", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await saveProfile(undefined, profileForm());
    await saveProfile(undefined, profileForm({ education: "[]" }));

    const profile = await getMyProfile(nora.accountId);
    expect(profile.education).toEqual([]);
  });

  it("refuses when there is no session at all", async () => {
    session.current = null;
    const res = await saveProfile(undefined, profileForm());
    expect(res.error).toBeTruthy();
  });

  it("writes nothing for an account id that does not exist", async () => {
    session.current = { accountId: "not-a-real-account" };
    const res = await saveProfile(undefined, profileForm());
    expect(res.error).toBeTruthy();
  });

  // ⚠️ The revocation guarantee. Sessions are stateless JWTs, so a closed account still holds a
  // perfectly valid cookie — the doorway is the ONLY place this can be enforced.
  it("writes nothing once the account is closed", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };
    await prisma.candidateAccount.update({
      where: { id: nora.accountId },
      data: { closedAt: new Date() },
    });

    const res = await saveProfile(undefined, profileForm({ firstName: "Changed" }));
    expect(res.error).toBeTruthy();

    const candidate = await asAna((tx) =>
      tx.candidate.findUnique({ where: { id: nora.candidateId }, select: { firstName: true } }),
    );
    expect(candidate.firstName).not.toBe("Changed");
  });

  it("cannot change the email address — the form field is not even read", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await saveProfile(undefined, profileForm({ email: "someone.else@example.com" }));

    const candidate = await asAna((tx) =>
      tx.candidate.findUnique({ where: { id: nora.candidateId }, select: { email: true } }),
    );
    expect(candidate.email).toBe("nora.adeyemi@example.com");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE GUARANTEE M6 ESTABLISHED AND M7 HAD TO KEEP.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("editing the profile does not change an application under review", () => {
  it("leaves the submitted snapshots untouched", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    const before = await asAna((tx) =>
      tx.application.findFirst({
        where: { candidateId: nora.candidateId },
        select: { id: true, employmentSnapshot: true, educationSnapshot: true },
      }),
    );

    await saveProfile(
      undefined,
      profileForm({
        employment: JSON.stringify([
          { employer: "Somewhere Else", title: "Other", startDate: "2025-01", endDate: "", summary: "" },
        ]),
      }),
    );

    const after = await asAna((tx) =>
      tx.application.findUnique({
        where: { id: before.id },
        select: { employmentSnapshot: true, educationSnapshot: true },
      }),
    );
    expect(after.employmentSnapshot).toEqual(before.employmentSnapshot);
    expect(after.educationSnapshot).toEqual(before.educationSnapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// RÉSUMÉ LIFECYCLE — the invariant is that no key ever becomes unreferenced, because erasure
// sweeps storage using keys it reads from the database.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("managing the CV on file", () => {
  it("uploads a CV and serves it back through the doorway", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    const res = await replaceResume(undefined, resumeForm(fakeFile({ name: "nora-cv.pdf" })));
    expect(res.ok).toBe(true);
    expect(puts).toHaveLength(1);

    const resume = await getMyResume(nora.accountId);
    expect(resume.fileName).toBe("nora-cv.pdf");
    expect(resume.key).toBe(puts[0]);
  });

  it("generates the storage key server-side, never from the filename", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "../../etc/passwd.pdf" })));

    expect(puts[0]).toMatch(/^resumes\/[0-9a-f-]{36}\.pdf$/);
  });

  it("rejects an oversized file before storing a byte", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    const res = await replaceResume(undefined, resumeForm(fakeFile({ size: 6 * 1024 * 1024 })));
    expect(res.error).toBeTruthy();
    expect(puts).toHaveLength(0);
  });

  it("rejects a file whose type and extension disagree", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    const res = await replaceResume(
      undefined,
      resumeForm(fakeFile({ name: "cv.exe", type: "application/pdf" })),
    );
    expect(res.error).toBeTruthy();
    expect(puts).toHaveLength(0);
  });

  // ⚠️ THE ORPHAN RULE, both halves.
  it("deletes a superseded CV that no application ever pinned", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "first.pdf" })));
    const firstKey = puts[0];
    await replaceResume(undefined, resumeForm(fakeFile({ name: "second.pdf" })));

    // Nothing referenced the first file, so it is genuinely orphanable and must go.
    expect(removes).toEqual([firstKey]);
  });

  it("KEEPS a superseded CV that an application still pins", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    // Seeded applications pin whatever was on file at submit; give this one a real key first.
    await replaceResume(undefined, resumeForm(fakeFile({ name: "applied-with.pdf" })));
    const pinnedKey = puts[0];
    await asAna((tx) =>
      tx.application.updateMany({
        where: { candidateId: nora.candidateId },
        data: { resumeKey: pinnedKey, resumeFileName: "applied-with.pdf" },
      }),
    );

    await replaceResume(undefined, resumeForm(fakeFile({ name: "newer.pdf" })));

    // The application under review must keep the document it was submitted with.
    expect(removes).toEqual([]);
    const app = await asAna((tx) =>
      tx.application.findFirst({
        where: { candidateId: nora.candidateId },
        select: { resumeKey: true },
      }),
    );
    expect(app.resumeKey).toBe(pinnedKey);
  });

  it("removing the CV from the profile leaves the applications' copies alone", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "cv.pdf" })));
    const key = puts[0];
    await asAna((tx) =>
      tx.application.updateMany({
        where: { candidateId: nora.candidateId },
        data: { resumeKey: key, resumeFileName: "cv.pdf" },
      }),
    );

    const res = await removeResume(undefined);
    expect(res.ok).toBe(true);
    expect(removes).toEqual([]);
    expect(await getMyResume(nora.accountId)).toBeNull();

    const app = await asAna((tx) =>
      tx.application.findFirst({
        where: { candidateId: nora.candidateId },
        select: { resumeKey: true },
      }),
    );
    expect(app.resumeKey).toBe(key);
  });

  it("reports a leftover file rather than claiming a clean success", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "first.pdf" })));
    removeFails = true;
    const res = await replaceResume(undefined, resumeForm(fakeFile({ name: "second.pdf" })));

    // The database work stands — it cannot be rolled back — but the user is told what is left.
    expect(res.ok).toBe(true);
    expect(res.warning).toBeTruthy();
  });

  it("takes the new blob back out when the doorway refuses", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    await prisma.candidateAccount.update({
      where: { id: nora.accountId },
      data: { closedAt: new Date() },
    });
    session.current = { accountId: nora.accountId };

    const res = await replaceResume(undefined, resumeForm());
    expect(res.error).toBeTruthy();
    // Stored, then refused — the file must not be left where erasure can never reach it.
    expect(removes).toEqual([puts[0]]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE PIN ITSELF — what an application carries, and what it keeps carrying.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("an application pins the CV it was submitted with", () => {
  async function applyAs(email, jobId, overrides = {}) {
    const f = new FormData();
    const base = {
      firstName: "Ada",
      lastName: "Lovelace",
      email,
      employment: JSON.stringify(EMPLOYMENT),
      education: JSON.stringify(EDUCATION),
      consent: "on",
    };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v !== undefined) f.set(k, v);
    try {
      return (await submitApplication(jobId, null, undefined, f)) ?? {};
    } catch (e) {
      if (e.__redirect) return { ok: true };
      throw e;
    }
  }

  it("pins the attached file, and a SECOND application pins the newer one", async () => {
    await applyAs("ada@example.com", "job-be", { resume: fakeFile({ name: "one.pdf" }) });
    const firstKey = puts[0];

    await applyAs("ada@example.com", "job-pd", { resume: fakeFile({ name: "two.pdf" }) });
    const secondKey = puts[1];

    const apps = await asAna((tx) =>
      tx.application.findMany({
        where: { candidate: { email: "ada@example.com" } },
        orderBy: { appliedAt: "asc" },
        select: { jobId: true, resumeKey: true, resumeFileName: true },
      }),
    );
    expect(apps.map((a) => a.resumeKey)).toEqual([firstKey, secondKey]);
    expect(apps.map((a) => a.resumeFileName)).toEqual(["one.pdf", "two.pdf"]);
  });

  // ⚠️ THE SECURITY PROPERTY, not merely a preference. The apply endpoint resolves people by EMAIL,
  // never by session, so if a submission could overwrite Candidate.resumeKey then anyone who knows
  // an address could replace the CV on that person's profile.
  it("does NOT overwrite the CV on the candidate's profile", async () => {
    await applyAs("ada@example.com", "job-be", { resume: fakeFile({ name: "one.pdf" }) });
    const profileKey = puts[0];

    await applyAs("ada@example.com", "job-pd", { resume: fakeFile({ name: "two.pdf" }) });

    const candidate = await asAna((tx) =>
      tx.candidate.findFirst({
        where: { email: "ada@example.com" },
        select: { resumeKey: true, resumeFileName: true },
      }),
    );
    expect(candidate.resumeKey).toBe(profileKey);
    expect(candidate.resumeFileName).toBe("one.pdf");
  });

  it("pins the CV already on file when no new one is attached", async () => {
    await applyAs("ada@example.com", "job-be", { resume: fakeFile({ name: "one.pdf" }) });
    const key = puts[0];

    await applyAs("ada@example.com", "job-pd");

    const second = await asAna((tx) =>
      tx.application.findFirst({
        where: { candidate: { email: "ada@example.com" }, jobId: "job-pd" },
        select: { resumeKey: true, resumeFileName: true },
      }),
    );
    expect(second.resumeKey).toBe(key);
    expect(second.resumeFileName).toBe("one.pdf");
  });

  // ⚠️ Regression guard. The duplicate check used to run AFTER the candidate write, so a refused
  // submission could gap-fill the candidate row with a key whose blob the caller then deleted.
  it("writes nothing at all when the same job is applied to twice", async () => {
    await applyAs("ada@example.com", "job-be");

    const res = await applyAs("ada@example.com", "job-be", { resume: fakeFile({ name: "late.pdf" }) });
    expect(res.error).toBeTruthy();

    const candidate = await asAna((tx) =>
      tx.candidate.findFirst({ where: { email: "ada@example.com" }, select: { resumeKey: true } }),
    );
    // The refused upload was removed by the caller, so the row must not point at it.
    expect(candidate.resumeKey).toBeNull();
    expect(removes).toEqual([puts[0]]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ERASURE — the only thing that ever deletes a résumé blob, so it must find every one.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("erasure reaches every résumé the person has", () => {
  it("returns the profile CV and each application's pinned CV, without duplicates", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "pinned.pdf" })));
    const pinnedKey = puts[0];
    await asAna((tx) =>
      tx.application.updateMany({
        where: { candidateId: nora.candidateId },
        data: { resumeKey: pinnedKey, resumeFileName: "pinned.pdf" },
      }),
    );
    // Replacing now leaves the pinned file alive and puts a second one on the profile.
    await replaceResume(undefined, resumeForm(fakeFile({ name: "current.pdf" })));
    const currentKey = puts[1];

    const [res] = await asAna(
      (tx) => tx.$queryRaw`SELECT result, resume_keys FROM app_erase_candidate(${nora.candidateId}, 'test')`,
    );
    expect(res.result).toBe("OK");
    expect([...res.resume_keys].sort()).toEqual([pinnedKey, currentKey].sort());

    const app = await asAna((tx) =>
      tx.application.findFirst({
        where: { candidateId: nora.candidateId },
        select: { resumeKey: true, resumeFileName: true },
      }),
    );
    expect(app.resumeKey).toBeNull();
    expect(app.resumeFileName).toBeNull();
  });

  it("reports one key once when the profile and the application share a file", async () => {
    const nora = await accountFor("nora.adeyemi@example.com");
    session.current = { accountId: nora.accountId };

    await replaceResume(undefined, resumeForm(fakeFile({ name: "shared.pdf" })));
    const key = puts[0];
    await asAna((tx) =>
      tx.application.updateMany({
        where: { candidateId: nora.candidateId },
        data: { resumeKey: key, resumeFileName: "shared.pdf" },
      }),
    );

    const [res] = await asAna(
      (tx) => tx.$queryRaw`SELECT result, resume_keys FROM app_erase_candidate(${nora.candidateId}, 'test')`,
    );
    // Asking storage to delete the same key twice would turn a success into a spurious failure.
    expect(res.resume_keys).toEqual([key]);
  });
});
