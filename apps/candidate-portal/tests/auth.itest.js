import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

// The sign-in action redirects on EVERY outcome, so a thrown redirect is the normal path here.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = url;
    throw e;
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.9"]]) }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
// Never hit SMTP in tests, but DO record what would have been sent — several assertions below turn
// on whether an email was attempted at all.
const sent = [];
// ⚠️ Spreads the real module rather than replacing it. M8 added `deliverCandidateStageEmail` and
// `candidateStageEmail` to this package; a factory returning only `sendMail` makes those undefined
// for anything this file imports transitively — a break that would surface as a confusing
// "not a function" far from here.
vi.mock("../../../packages/notifications/src/transport.js", () => ({
  DEFAULT_FROM: "FrogsAtWorkHR <no-reply@test>",
  sendMail: vi.fn(async (msg) => {
    sent.push(msg);
  }),
}));
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { requestLoginLink } from "../app/sign-in/actions.js";
import { hashLoginToken } from "../lib/tokens.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const NORA = "nora.adeyemi@example.com";

const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

// Every call ends in a redirect; return where it went plus any field error.
async function requestLink(email) {
  try {
    const res = await requestLoginLink(undefined, fd({ email }));
    return { ...(res ?? {}), redirected: null };
  } catch (e) {
    if (e.__redirect) return { redirected: e.__redirect };
    throw e;
  }
}

// Look the account up BY candidateId, never by joining "Candidate".
// "CandidateAccount" has no RLS (the auth flow must read it pre-session), but "Candidate" does — so
// a bare join filter matches nothing with no session variables set. That is the policy working, and
// it caught a sloppy first version of this helper.
const accountFor = (candidateId) => prisma.candidateAccount.findUnique({ where: { candidateId } });

// The raw token out of the most recent email — the applicant's view of the link.
const linkToken = () => sent[sent.length - 1].text.match(/token=([\w-]+)/)[1];

// Redeem exactly as the Credentials provider does.
const redeem = (rawToken) =>
  prisma.$queryRaw`SELECT account_id, candidate_id, org_id FROM app_redeem_candidate_login(${hashLoginToken(rawToken)})`;

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

describe("requesting a login link never reveals who is in the database", () => {
  it("answers identically for a known and an unknown address", async () => {
    const known = await requestLink(NORA);
    const unknown = await requestLink("nobody-here@example.com");
    expect(known.redirected).toBe("/sign-in/sent");
    expect(unknown.redirected).toBe("/sign-in/sent");
    expect(unknown).toEqual(known); // byte-for-byte the same outcome
  });

  it("issues a token ONLY for the known address", async () => {
    await requestLink(NORA);
    await requestLink("nobody-here@example.com");
    expect(await accountFor("cand-nora")).not.toBeNull();
    expect(sent.map((m) => m.to)).toEqual([NORA]); // one email, to the real person
    expect(await prisma.candidateAccount.count()).toBe(1);
  });

  it("still reports a malformed address, which reveals nothing about our data", async () => {
    const res = await requestLink("not-an-email");
    expect(res.error).toBeTruthy();
    expect(res.redirected).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("never puts the raw token in the database — only its hash", async () => {
    await requestLink(NORA);
    const link = sent[0].text.match(/token=([\w-]+)/)[1];
    const account = await accountFor("cand-nora");
    expect(account.loginTokenHash).toBe(hashLoginToken(link));
    expect(account.loginTokenHash).not.toBe(link);
  });
});

describe("redeeming a link", () => {
  it("signs in a real applicant and returns their identity", async () => {
    await requestLink(NORA);
    const [row] = await redeem(linkToken());
    expect(row.candidate_id).toBe("cand-nora");
    expect(row.org_id).toBe(ORG);
    // No role, no employeeId — nothing shaped like a staff Viewer.
    expect(row).not.toHaveProperty("role");
  });

  it("is SINGLE USE — a replayed link is dead", async () => {
    await requestLink(NORA);
    const token = linkToken();
    expect(await redeem(token)).toHaveLength(1);
    expect(await redeem(token)).toHaveLength(0);
  });

  it("rejects a token that has expired", async () => {
    await requestLink(NORA);
    const token = linkToken();
    await prisma.$executeRaw`
      UPDATE "CandidateAccount" SET "loginTokenExpires" = now() - interval '1 minute'`;
    expect(await redeem(token)).toHaveLength(0);
  });

  it("rejects a token that was never issued", async () => {
    expect(await redeem("totally-made-up-token")).toHaveLength(0);
  });

  it("a NEW request invalidates the previous link", async () => {
    await requestLink(NORA);
    const first = linkToken();
    await requestLink(NORA);
    const second = linkToken();
    expect(second).not.toBe(first);
    expect(await redeem(first)).toHaveLength(0); // superseded
    expect(await redeem(second)).toHaveLength(1);
  });
});

describe("accounts an applicant must not be able to use", () => {
  it("refuses an ERASED candidate, and their old link stops working", async () => {
    await requestLink(NORA);
    const token = linkToken();
    await withViewer(ANA, (tx) => tx.$queryRaw`SELECT * FROM app_erase_candidate('cand-nora', 'test')`);

    expect(await redeem(token)).toHaveLength(0);
    sent.length = 0;
    await requestLink(NORA); // their address is a scrambled placeholder now
    expect(sent).toHaveLength(0);
  });

  it("refuses a CLOSED account (the hired case) and kills its live link", async () => {
    await requestLink(NORA);
    const token = linkToken();
    // M14: the doorway is role-guarded now — call it as HR_ADMIN, as a real hire would.
    await withViewer(ANA, (tx) => tx.$executeRaw`SELECT app_close_candidate_account('cand-nora')`);

    expect(await redeem(token)).toHaveLength(0);
    sent.length = 0;
    await requestLink(NORA);
    expect(sent).toHaveLength(0); // no new link either
  });

  it("still serves an ARCHIVED candidate — retention housekeeping is not a judgement on them", async () => {
    await withViewer(ANA, (tx) =>
      tx.candidate.update({ where: { id: "cand-nora" }, data: { archivedAt: new Date() } }),
    );
    await requestLink(NORA);
    expect(sent).toHaveLength(1);
    expect(await redeem(linkToken())).toHaveLength(1);
  });
});


describe("being hired closes the portal account", () => {
  it("app_link_hire closes it in the same statement that records the onboarding", async () => {
    await requestLink("luis.romero@example.com");
    const token = linkToken();
    expect(await accountFor("cand-luis")).not.toBeNull();

    // Drive the real seam: Luis reaches HIRED, then HR links him to a new employee record.
    const employeeId = "40000000-0000-0000-0000-000000000006"; // an existing employee in this org
    await withViewer(ANA, async (tx) => {
      await tx.$executeRaw`UPDATE "Application" SET stage='HIRED' WHERE id='app-luis'`;
      await tx.$executeRaw`UPDATE "Application" SET "hiredEmployeeId"=NULL WHERE id='app-luis'`;
      const [r] = await tx.$queryRaw`SELECT app_link_hire('app-luis', ${employeeId}) AS result`;
      expect(r.result).toBe("OK");
    });

    const account = await accountFor("cand-luis");
    expect(account.closedAt).not.toBeNull();
    expect(account.loginTokenHash).toBeNull(); // the live link died with it
    expect(await redeem(token)).toHaveLength(0);
  });
});

describe("erasure destroys the account outright", () => {
  it("deletes the row rather than blanking it", async () => {
    await requestLink(NORA);
    expect(await accountFor("cand-nora")).not.toBeNull();

    const [res] = await withViewer(ANA, (tx) =>
      tx.$queryRaw`SELECT result FROM app_erase_candidate('cand-nora', 'test erasure')`,
    );
    expect(res.result).toBe("OK");
    expect(await prisma.candidateAccount.findUnique({ where: { candidateId: "cand-nora" } })).toBeNull();
  });
});
