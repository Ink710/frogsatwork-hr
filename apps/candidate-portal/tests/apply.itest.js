import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";
// M8: stub ONLY the network hop — the claim/mark/idempotency logic runs for real.
// Target the transport module, not the package: deliver.js imports it relatively, so mocking
// "@hris/notifications" would leave the real nodemailer in place and the mailbox silently empty.
import { resetMailbox, mailbox } from "../../../test/mailbox.js";
vi.mock("../../../packages/notifications/src/transport.js", async () => {
  const { fakeSendMail } = await import("../../../test/mailbox.js");
  return { sendMail: fakeSendMail, DEFAULT_FROM: "FrogsAtWorkHR <no-reply@test>" };
});


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

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { PRIVACY_POLICY_VERSION } from "@hris/recruiting";
import { submitApplication } from "../app/jobs/[id]/apply/actions.js";
import { getMyProfile } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};

const EMPLOYMENT = [{ employer: "Acme Corp", title: "Engineer", startDate: "2022-01", endDate: "", summary: "Built things" }];
const EDUCATION = [{ institution: "State University", qualification: "BSc Computer Science", startDate: "2016-09", endDate: "2020-06" }];

function form(o = {}) {
  const f = new FormData();
  const base = {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
    employment: JSON.stringify(EMPLOYMENT), education: JSON.stringify(EDUCATION),
    consent: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) if (v !== undefined) f.set(k, v);
  return f;
}

async function apply(jobId = "job-be", overrides = {}, source = null) {
  try {
    const res = await submitApplication(jobId, source, undefined, form(overrides));
    return res ?? {};
  } catch (e) {
    if (e.__redirect) return { ok: true, redirected: e.__redirect };
    throw e;
  }
}

// Read back as HR, since Candidate/Application are RLS'd.
const asAna = (fn) => withViewer(ANA, fn);
const candidateByEmail = (email) => asAna((tx) => tx.candidate.findFirst({ where: { email } }));

beforeEach(async () => {
  await resetDb();
  resetMailbox();
});

describe("a full submission lands atomically", () => {
  it("creates the candidate, application, profile, snapshot and consent in one go", async () => {
    expect((await apply()).ok).toBe(true);

    const cand = await candidateByEmail("ada@example.com");
    expect(cand).not.toBeNull();

    const app = await asAna((tx) =>
      tx.application.findFirst({ where: { candidateId: cand.id }, include: { consent: true } }),
    );
    expect(app.stage).toBe("APPLIED");

    // Profile master…
    const employment = await asAna((tx) => tx.candidateEmployment.findMany({ where: { candidateId: cand.id } }));
    expect(employment).toHaveLength(1);
    expect(employment[0].employer).toBe("Acme Corp");
    expect(employment[0].endDate).toBeNull(); // "" means still there, and must land as NULL

    const education = await asAna((tx) => tx.candidateEducation.findMany({ where: { candidateId: cand.id } }));
    expect(education[0].institution).toBe("State University");

    // …and the frozen copy on the application.
    expect(app.employmentSnapshot[0].employer).toBe("Acme Corp");
    expect(app.educationSnapshot[0].institution).toBe("State University");

    // …and the consent record, stamped with the version in code.
    expect(app.consent.policyVersion).toBe(PRIVACY_POLICY_VERSION);
  });

  it("refuses without consent, and writes NOTHING", async () => {
    // An unchecked box must fail loudly rather than silently recording a consent nobody gave.
    const res = await apply("job-be", { consent: undefined });
    expect(res.error).toBeTruthy();
    expect(await candidateByEmail("ada@example.com")).toBeNull();
  });

  it("rejects an end month before a start month before touching the database", async () => {
    const res = await apply("job-be", {
      employment: JSON.stringify([{ employer: "Acme", title: "Eng", startDate: "2022-06", endDate: "2022-01" }]),
    });
    expect(res.error).toBeTruthy();
    expect(await candidateByEmail("ada@example.com")).toBeNull();
  });

  it("still refuses a closed req, leaving no half-application behind", async () => {
    await asAna((tx) => tx.job.update({ where: { id: "job-pd" }, data: { status: "CLOSED" } }));
    expect((await apply("job-pd")).error).toBeTruthy();
    expect(await candidateByEmail("ada@example.com")).toBeNull();
  });
});

describe("the snapshot is frozen — the whole point of the fork", () => {
  it("editing the profile afterwards does NOT change what the application says", async () => {
    await apply();
    const cand = await candidateByEmail("ada@example.com");

    // The applicant later corrects their profile — as they are entitled to.
    await asAna((tx) =>
      tx.candidateEmployment.updateMany({
        where: { candidateId: cand.id },
        data: { employer: "Globex Corporation" },
      }),
    );

    const app = await asAna((tx) => tx.application.findFirst({ where: { candidateId: cand.id } }));
    // The recruiter still reads exactly what arrived.
    expect(app.employmentSnapshot[0].employer).toBe("Acme Corp");

    const profile = await asAna((tx) => tx.candidateEmployment.findMany({ where: { candidateId: cand.id } }));
    expect(profile[0].employer).toBe("Globex Corporation");
  });

  it("a SECOND application snapshots the profile as it stood THEN", async () => {
    await apply("job-be");
    await apply("job-pd", {
      employment: JSON.stringify([{ employer: "Globex", title: "Staff Engineer", startDate: "2024-01", endDate: "" }]),
    });

    const cand = await candidateByEmail("ada@example.com");
    const apps = await asAna((tx) =>
      tx.application.findMany({ where: { candidateId: cand.id }, orderBy: { jobId: "asc" } }),
    );
    const employers = apps.map((a) => a.employmentSnapshot[0].employer).sort();
    expect(employers).toEqual(["Acme Corp", "Globex"]);

    // …while the PROFILE holds only the latest, because submitting replaces it.
    const profile = await asAna((tx) => tx.candidateEmployment.findMany({ where: { candidateId: cand.id } }));
    expect(profile).toHaveLength(1);
    expect(profile[0].employer).toBe("Globex");
  });
});

describe("erasure", () => {
  it("destroys the profile and snapshots but KEEPS the consent record", async () => {
    await apply();
    const cand = await candidateByEmail("ada@example.com");

    const [res] = await asAna((tx) =>
      tx.$queryRaw`SELECT result FROM app_erase_candidate(${cand.id}, 'test erasure')`,
    );
    expect(res.result).toBe("OK");

    expect(await asAna((tx) => tx.candidateEmployment.count({ where: { candidateId: cand.id } }))).toBe(0);
    expect(await asAna((tx) => tx.candidateEducation.count({ where: { candidateId: cand.id } }))).toBe(0);

    const app = await asAna((tx) =>
      tx.application.findFirst({ where: { candidateId: cand.id }, include: { consent: true } }),
    );
    expect(app.employmentSnapshot).toBeNull();
    expect(app.educationSnapshot).toBeNull();

    // ⚠️ KEPT ON PURPOSE. It holds a version, a timestamp and a link — no personal data — and it is
    // the evidence that the processing we did was lawful. Deleting it protects nobody.
    expect(app.consent).not.toBeNull();
    expect(app.consent.policyVersion).toBe(PRIVACY_POLICY_VERSION);
  });

  it("leaves no employer name anywhere in the erased application", async () => {
    await apply();
    const cand = await candidateByEmail("ada@example.com");
    await asAna((tx) => tx.$queryRaw`SELECT result FROM app_erase_candidate(${cand.id}, 'test')`);

    const app = await asAna((tx) => tx.application.findFirst({ where: { candidateId: cand.id } }));
    expect(JSON.stringify(app)).not.toContain("Acme");
    expect(JSON.stringify(app)).not.toContain("State University");
  });
});

describe("profile prefill", () => {
  it("reads the applicant's own profile back through the doorway", async () => {
    await apply();
    const cand = await candidateByEmail("ada@example.com");

    const [issued] = await prisma.$queryRaw`
      SELECT candidate_id FROM app_issue_candidate_login('ada@example.com','h-ada',(now() + interval '30 min')::timestamp(3))`;
    const account = await prisma.candidateAccount.findUnique({
      where: { candidateId: issued.candidate_id },
      select: { id: true },
    });

    const profile = await getMyProfile(account.id);
    expect(profile.firstName).toBe("Ada");
    expect(profile.employment[0].employer).toBe("Acme Corp");
    // Timestamps come back as the YYYY-MM the form's month inputs use.
    expect(profile.employment[0].startDate).toBe("2022-01");
    expect(profile.employment[0].endDate).toBe(""); // still there
    expect(profile.education[0].endDate).toBe("2020-06");
    expect(cand.id).toBe(issued.candidate_id);
  });

  it("returns nothing once the account is closed", async () => {
    await apply();
    const [issued] = await prisma.$queryRaw`
      SELECT candidate_id FROM app_issue_candidate_login('ada@example.com','h-ada2',(now() + interval '30 min')::timestamp(3))`;
    const account = await prisma.candidateAccount.findUnique({
      where: { candidateId: issued.candidate_id },
      select: { id: true },
    });

    await prisma.$executeRaw`SELECT app_close_candidate_account(${issued.candidate_id})`;
    expect(await getMyProfile(account.id)).toBeNull();
  });
});

// ── M8: the receipt ──────────────────────────────────────────────────────────────────────────

describe("applying acknowledges the application", () => {
  it("sends a receipt to the applicant and records the delivery", async () => {
    await apply();

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].to).toBe("ada@example.com");
    expect(mailbox[0].text).toContain("Senior Backend Engineer");

    // Keyed on the APPLIED event the doorway returned — which is the only reason it returns one.
    const rows = await asAna((tx) =>
      tx.notificationDelivery.findMany({ select: { status: true, applicationEventId: true } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");

    // ⚠️ Scoped to ADA's application: the seed already contains APPLIED events for other
    // candidates, so an unscoped query picks a seeded row and compares the wrong ids.
    const [event] = await asAna((tx) =>
      tx.applicationEvent.findMany({
        where: { toStage: "APPLIED", application: { candidate: { email: "ada@example.com" } } },
        select: { id: true },
      }),
    );
    expect(rows[0].applicationEventId).toBe(event.id);
  });

  it("captures the applicant's own locale at apply time", async () => {
    // The i18n mock pins the request locale to "en", and on a PUBLIC page that cookie is the
    // applicant's own — the one moment in the whole flow when it is.
    await apply();
    const c = await candidateByEmail("ada@example.com");
    expect(c.locale).toBe("en");
  });

  it("a refused duplicate acknowledges nothing", async () => {
    await apply();
    resetMailbox();

    const res = await apply();
    expect(res.error).toBeTruthy();
    expect(mailbox).toHaveLength(0);
  });

  it("a submission that fails validation acknowledges nothing", async () => {
    const res = await apply("job-be", { email: "not-an-email" });
    expect(res.error).toBeTruthy();
    expect(mailbox).toHaveLength(0);
  });
});
