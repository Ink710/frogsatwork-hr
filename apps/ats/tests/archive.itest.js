import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  const roles = await import("../../../packages/auth/src/roles");
  return { getViewer: vi.fn(), withViewer: rls.withViewer, isRecruiter: roles.isRecruiter };
});

import { getViewer, withViewer } from "@hris/auth";
import { prisma } from "@hris/database";
import { archiveCandidate, restoreCandidate } from "../app/(internal)/candidates/archive.js";
import { eraseCandidate } from "../app/(internal)/compliance/actions.js";
import { runRetentionSweepForOrg } from "../lib/retention-sweep.js";
import {
  getCandidates,
  getRetentionDays,
  getFunnelReport,
  getSourceReport,
  getTimeReport,
} from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);

const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const readCandidate = (id) =>
  withViewer(V.ana, async (tx) => (await tx.candidate.findMany({ where: { id } }))[0]);

/**
 * Build a candidate inline rather than seeding one.
 *
 * The base fixture is deliberately left alone — its exact counts are what candidates.itest.js and
 * reports.itest.js assert — and a sweep test needs precise control over dates anyway. BOTH
 * `createdAt` and the event's `occurredAt` are backdated, because the sweep takes the LATER of the
 * two; backdating only one leaves the candidate looking recent.
 */
async function makeCandidate({ id, stage = "REJECTED", idleDays = 400 }) {
  const at = daysAgo(idleDays);
  await withViewer(V.ana, async (tx) => {
    await tx.candidate.create({
      data: {
        id, firstName: "Test", lastName: id, email: `${id}@example.com`,
        source: "Careers page", orgId: ORG, createdAt: at,
      },
    });
    await tx.application.create({
      data: { id: `app-${id}`, orgId: ORG, jobId: "job-be", candidateId: id, stage, appliedAt: at, createdAt: at },
    });
    await tx.applicationEvent.create({
      data: {
        id: `ae-${id}`, applicationId: `app-${id}`, jobId: "job-be",
        fromStage: null, toStage: "APPLIED", occurredAt: at,
        actorId: "00000000-0000-0000-0000-000000000001",
      },
    });
  });
  return id;
}

const sweep = (opts) => runRetentionSweepForOrg(ORG, opts);

beforeEach(async () => {
  await resetDb();
  as(V.raj);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("archiving by hand", () => {
  it("removes a candidate from the default list without deleting anything", async () => {
    const before = await getCandidates();
    expect(await archiveCandidate("cand-mei")).toEqual({ ok: true });

    const after = await getCandidates();
    expect(after.total).toBe(before.total - 1);
    expect(after.rows.some((r) => r.id === "cand-mei")).toBe(false);

    const mei = await readCandidate("cand-mei");
    expect(mei.archivedAt).not.toBeNull();
    expect(mei.firstName).toBe("Mei"); // intact — this is not erasure
    expect(mei.email).toBe("mei.tanaka@example.com");
  });

  it("records WHO archived them", async () => {
    await archiveCandidate("cand-mei");
    expect((await readCandidate("cand-mei")).archivedById).toBe(V.raj.employeeId);
  });

  it("shows them again with the filter, so the list reconciles with the reports", async () => {
    await archiveCandidate("cand-mei");
    const withArchived = await getCandidates({ includeArchived: true });
    const row = withArchived.rows.find((r) => r.id === "cand-mei");
    expect(row).toBeDefined();
    expect(row.archivedAt).not.toBeNull();
  });

  it("restores them, clearing the archiver as well as the timestamp", async () => {
    await archiveCandidate("cand-mei");
    expect(await restoreCandidate("cand-mei")).toEqual({ ok: true });

    const mei = await readCandidate("cand-mei");
    expect(mei.archivedAt).toBeNull();
    expect(mei.archivedById).toBeNull();
    expect((await getCandidates()).rows.some((r) => r.id === "cand-mei")).toBe(true);
  });

  it("is refused for an interviewer and for a hiring manager", async () => {
    for (const persona of [V.diego, V.marcus]) {
      as(persona);
      expect((await archiveCandidate("cand-mei")).error).toBeTruthy();
    }
    as(V.raj);
    expect((await readCandidate("cand-mei")).archivedAt).toBeNull();
  });

  it("is allowed for HR as well as recruiters", async () => {
    as(V.ana);
    expect(await archiveCandidate("cand-mei")).toEqual({ ok: true });
  });

  it("refuses to archive an erased shell — there is nothing left to move out of the way", async () => {
    as(V.ana);
    await eraseCandidate("cand-mei", undefined, fd({ confirm: "ERASE", note: "GDPR" }));
    expect((await archiveCandidate("cand-mei")).error).toBeTruthy();
    expect((await readCandidate("cand-mei")).archivedAt).toBeNull();
  });
});

describe("what archiving must NOT change", () => {
  it("leaves every reporting figure identical — the same guarantee erasure makes", async () => {
    as(V.ana);
    const before = {
      funnel: await getFunnelReport(),
      sources: await getSourceReport(),
      times: await getTimeReport(),
    };

    as(V.raj);
    await archiveCandidate("cand-mei");

    as(V.ana);
    expect(await getFunnelReport()).toEqual(before.funnel);
    expect(await getSourceReport()).toEqual(before.sources);
    expect(await getTimeReport()).toEqual(before.times);
  });

  it("leaves them findable on the pipeline board they're still attached to", async () => {
    await archiveCandidate("cand-mei");
    const apps = await withViewer(V.raj, (tx) => tx.application.findMany({ where: { candidateId: "cand-mei" } }));
    expect(apps.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("the retention sweep", () => {
  it("archives a long-cold, closed-out candidate", async () => {
    await makeCandidate({ id: "cold-one", idleDays: 400 });
    const result = await sweep();

    expect(result.archived).toBe(1);
    expect((await readCandidate("cold-one")).archivedAt).not.toBeNull();
  });

  it("attributes it to the POLICY, not a person", async () => {
    await makeCandidate({ id: "cold-one", idleDays: 400 });
    await sweep();
    // A null archivedById is what makes the UI say "archived by the retention policy".
    expect((await readCandidate("cold-one")).archivedById).toBeNull();
  });

  it("NEVER touches someone still in an active pipeline stage", async () => {
    for (const stage of ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"]) {
      await makeCandidate({ id: `active-${stage}`, stage, idleDays: 2000 });
    }
    await sweep();
    for (const stage of ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"]) {
      expect((await readCandidate(`active-${stage}`)).archivedAt).toBeNull();
    }
  });

  it("leaves recently active candidates alone", async () => {
    await makeCandidate({ id: "warm-one", idleDays: 30 });
    await sweep();
    expect((await readCandidate("warm-one")).archivedAt).toBeNull();
  });

  it("does archive a HIRED candidate — they're an employee now", async () => {
    await makeCandidate({ id: "hired-one", stage: "HIRED", idleDays: 400 });
    await sweep();
    expect((await readCandidate("hired-one")).archivedAt).not.toBeNull();
  });

  it("skips erased shells", async () => {
    await makeCandidate({ id: "cold-erased", idleDays: 400 });
    as(V.ana);
    await eraseCandidate("cold-erased", undefined, fd({ confirm: "ERASE", note: "GDPR" }));
    await sweep();
    expect((await readCandidate("cold-erased")).archivedAt).toBeNull();
  });

  it("is idempotent — a second run changes nothing and does not restamp the first", async () => {
    await makeCandidate({ id: "cold-one", idleDays: 400 });
    await sweep();
    const stamped = (await readCandidate("cold-one")).archivedAt;

    const second = await sweep();
    expect(second.archived).toBe(0);
    expect((await readCandidate("cold-one")).archivedAt.toISOString()).toBe(stamped.toISOString());
  });

  it("honours the retention window", async () => {
    await makeCandidate({ id: "cold-90", idleDays: 120 });
    expect((await sweep({ retentionDays: 365 })).archived).toBe(0);
    expect((await sweep({ retentionDays: 90 })).archived).toBe(1);
  });

  it("reads the window from AppSetting", async () => {
    expect(await getRetentionDays()).toBe(365);
    await prisma.appSetting.update({ where: { key: "candidateRetentionDays" }, data: { value: "30" } });
    expect(await getRetentionDays()).toBe(30);
  });

  it("falls back to the default when the setting is nonsense rather than archiving everyone", async () => {
    await prisma.appSetting.update({ where: { key: "candidateRetentionDays" }, data: { value: "0" } });
    expect(await getRetentionDays()).toBe(365);

    await makeCandidate({ id: "warm-one", idleDays: 30 });
    await sweep();
    expect((await readCandidate("warm-one")).archivedAt).toBeNull();
  });

  it("leaves the reports untouched, exactly like a manual archive", async () => {
    await makeCandidate({ id: "cold-one", idleDays: 400 });
    as(V.ana);
    const before = await getFunnelReport();
    await sweep();
    expect(await getFunnelReport()).toEqual(before);
  });
});

describe("archive and erasure compose", () => {
  it("an archived candidate can still be erased, and stays archived afterwards", async () => {
    await archiveCandidate("cand-mei");
    as(V.ana);
    const res = await eraseCandidate("cand-mei", undefined, fd({ confirm: "ERASE", note: "GDPR" }));
    expect(res.error).toBeUndefined();

    const mei = await readCandidate("cand-mei");
    // The property that makes "the archive is a second place PII hides" impossible: there is only
    // ever ONE row, so erasing it covers every state it happens to be in.
    expect(mei.anonymisedAt).not.toBeNull();
    expect(mei.archivedAt).not.toBeNull();
    expect(mei.firstName).toBe("Erased");
  });
});
