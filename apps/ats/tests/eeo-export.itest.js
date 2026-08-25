import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";
// M8: stub ONLY the network hop — the claim/mark/idempotency logic runs for real.
// Target the transport module, not the package: deliver.js imports it relatively, so mocking
// "@hris/notifications" would leave the real nodemailer in place and the mailbox silently empty.
import { resetMailbox } from "../../../test/mailbox.js";
vi.mock("../../../packages/notifications/src/transport.js", async () => {
  const { fakeSendMail } = await import("../../../test/mailbox.js");
  return { sendMail: fakeSendMail, DEFAULT_FROM: "FrogsAtWorkHR <no-reply@test>" };
});


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
import { GET as exportRoute } from "../app/api/eeo-export/route.js";
import { moveApplication } from "../app/(internal)/jobs/actions.js";
import { eraseCandidate } from "../app/(internal)/compliance/actions.js";
import {
  getEeoSummary,
  getEeoFiling,
  canFileEeo,
  canReadEeo,
  getEeoExportHistory,
  getRejectionReport,
} from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  bianca: { userId: "30000000-0000-0000-0000-000000000003", employeeId: "40000000-0000-0000-0000-000000000003", role: "HR_GENERALIST", orgId: ORG },
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

const download = (variant) =>
  exportRoute(new Request(`http://localhost:3002/api/eeo-export?variant=${variant}`));

beforeEach(async () => {
  await resetDb();
  resetMailbox();
  as(V.ana);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("the two EEO gates are genuinely different questions", () => {
  it("lets an HR generalist read the report but NOT file exact counts", async () => {
    as(V.bianca);
    expect(await canReadEeo()).toBe(true);
    expect(await canFileEeo()).toBe(false);
    expect(await getEeoFiling()).toBeNull(); // refused, not empty
  });

  it("lets an HR admin do both", async () => {
    expect(await canReadEeo()).toBe(true);
    expect(await canFileEeo()).toBe(true);
    expect(await getEeoFiling()).not.toBeNull();
  });

  it("refuses both to a recruiter, a hiring manager and an interviewer", async () => {
    for (const persona of [V.raj, V.marcus, V.diego]) {
      as(persona);
      expect(await canReadEeo()).toBe(false);
      expect(await canFileEeo()).toBe(false);
    }
  });
});

describe("the export route", () => {
  it("returns a CSV attachment for the summary", async () => {
    const res = await download("summary");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="eeo-summary-.*\.csv"/);
  });

  it("returns a CSV attachment for the filing", async () => {
    const res = await download("filing");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="eeo1-filing-.*\.csv"/);
  });

  it("never caches an export of demographic data", async () => {
    expect((await download("summary")).headers.get("cache-control")).toBe("no-store");
  });

  it("403s the filing for an HR generalist, while still serving them the summary", async () => {
    as(V.bianca);
    expect((await download("filing")).status).toBe(403);
    expect((await download("summary")).status).toBe(200);
  });

  it("403s both for a recruiter", async () => {
    as(V.raj);
    expect((await download("summary")).status).toBe(403);
    expect((await download("filing")).status).toBe(403);
  });

  it("treats an unknown variant as the SAFE one, not the exact one", async () => {
    // A typo'd or hand-edited query string must never fall through to unsuppressed counts.
    as(V.bianca);
    const res = await exportRoute(new Request("http://localhost:3002/api/eeo-export?variant=nonsense"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SUPPRESSED");
  });
});

describe("suppressed vs exact — the whole point of two artifacts", () => {
  it("withholds small groups in the summary and reports them exactly in the filing", async () => {
    const summary = await (await download("summary")).text();
    const filing = await (await download("filing")).text();

    // The seeded pool is small enough that every dimension has withheld cells.
    expect(summary).toContain("SUPPRESSED");
    expect(summary).toContain("Groups smaller than 5 are withheld");

    // The filing suppresses no DATA cell (the word appears only in its own header banner).
    expect(filing).not.toMatch(/,SUPPRESSED/);
    expect(filing).toContain("EXACT COUNTS, NOT SUPPRESSED");
    expect(filing).toContain("Do not circulate internally");
  });

  it("groups the filing by EEO-1 job category and flags requisitions without one", async () => {
    const filing = await (await download("filing")).text();
    expect(filing).toContain("PROFESSIONALS"); // job-be is categorised in the seed
    // job-pd deliberately has no category, so the gap must be visible rather than silently bucketed.
    expect(filing).toContain("WARNING:");
    expect(filing).toMatch(/^UNCATEGORISED,/m);
  });
});

describe("the export audit trail", () => {
  it("records exactly one row per export, with the variant and the actor", async () => {
    await download("summary");
    await download("filing");

    const history = await getEeoExportHistory();
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.variant)).toEqual(["FILING", "SUMMARY"]); // newest first
    expect(history[0].actorName).toBe("Ana Okafor");
  });

  it("records a refused attempt NOWHERE — the log is exports, not attempts", async () => {
    as(V.bianca);
    await download("filing"); // 403
    as(V.ana);
    expect(await getEeoExportHistory()).toHaveLength(0);
  });

  it("carries the uncategorised count, so a filing can be explained after the fact", async () => {
    await download("filing");
    const [row] = await getEeoExportHistory();
    expect(row.uncategorisedJobs).toBeGreaterThan(0);
  });

  it("CANNOT be rewritten or deleted — the guarantee that makes it an audit trail", async () => {
    await download("filing");
    const [row] = await getEeoExportHistory();

    await expect(
      withViewer(V.ana, (tx) => tx.$executeRaw`UPDATE "EeoExportLog" SET "rowCount" = 0`),
    ).rejects.toThrow();
    await expect(
      withViewer(V.ana, (tx) => tx.$executeRaw`DELETE FROM "EeoExportLog"`),
    ).rejects.toThrow();

    const [after] = await getEeoExportHistory();
    expect(after.rowCount).toBe(row.rowCount);
  });

  it("is invisible to a recruiter", async () => {
    await download("filing");
    as(V.raj);
    expect(await getEeoExportHistory()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("structured rejection reasons", () => {
  const reject = (extra = {}) =>
    moveApplication("job-be", "app-nora", undefined, fd({ toStage: "REJECTED", ...extra }));

  beforeEach(() => as(V.raj));

  it("refuses a rejection with no reason", async () => {
    const res = await reject();
    expect(res.error).toBeTruthy();

    const [app] = await withViewer(V.raj, (tx) => tx.application.findMany({ where: { id: "app-nora" } }));
    expect(app.stage).toBe("APPLIED"); // nothing moved
  });

  it("refuses a rejection carrying only free text", async () => {
    const res = await reject({ rejectionReason: "Not enough Postgres depth" });
    expect(res.error).toBeTruthy();
  });

  it("records both the category and the free text when given", async () => {
    const res = await reject({
      rejectionCategory: "SKILLS_MISMATCH",
      rejectionReason: "Not enough Postgres depth",
    });
    expect(res.error).toBeUndefined();

    const [app] = await withViewer(V.raj, (tx) => tx.application.findMany({ where: { id: "app-nora" } }));
    expect(app.stage).toBe("REJECTED");
    expect(app.rejectionCategory).toBe("SKILLS_MISMATCH");
    expect(app.rejectionReason).toBe("Not enough Postgres depth");
  });

  it("is terminal — a rejection cannot be walked back, so the reason can never go stale", async () => {
    await reject({ rejectionCategory: "SKILLS_MISMATCH", rejectionReason: "Not enough depth" });

    // REJECTED has no outgoing transitions (ALLOWED_STAGE_TRANSITIONS), which is what makes the
    // recorded reason permanent. Re-opening someone means a NEW application, not an edited one.
    const res = await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "APPLIED" }));
    expect(res.error).toBeTruthy();

    const [app] = await withViewer(V.raj, (tx) => tx.application.findMany({ where: { id: "app-nora" } }));
    expect(app.stage).toBe("REJECTED");
    expect(app.rejectionCategory).toBe("SKILLS_MISMATCH");
  });

  it("does not require a reason for any other move", async () => {
    const res = await moveApplication("job-be", "app-nora", undefined, fd({ toStage: "SCREEN" }));
    expect(res.error).toBeUndefined();
  });
});

describe("the rejection report", () => {
  it("counts categorised rejections and reports the pre-M12 backlog separately", async () => {
    as(V.ana);
    const report = await getRejectionReport();
    // The seed rejects Owen on the design req with STRONGER_CANDIDATE.
    expect(report.rows.find((r) => r.category === "STRONGER_CANDIDATE").count).toBe(1);
    expect(report.categorised).toBe(1);
  });

  it("SURVIVES AN ERASURE — the reason M12 exists", async () => {
    as(V.raj);
    await moveApplication(
      "job-be",
      "app-nora",
      undefined,
      fd({
        toStage: "REJECTED",
        rejectionCategory: "SKILLS_MISMATCH",
        rejectionReason: "Nora mentioned she knows Marcus personally",
      }),
    );

    as(V.ana);
    const before = await getRejectionReport();
    await eraseCandidate("cand-nora", undefined, fd({ confirm: "ERASE", note: "GDPR" }));
    const after = await getRejectionReport();

    // The prose is destroyed…
    const [app] = await withViewer(V.ana, (tx) => tx.application.findMany({ where: { id: "app-nora" } }));
    expect(app.rejectionReason).toBeNull();
    // …the category and therefore the report are untouched. Free text could not have done this.
    expect(app.rejectionCategory).toBe("SKILLS_MISMATCH");
    expect(after).toEqual(before);
  });

  it("is RLS-scoped like every other figure on /reports", async () => {
    as(V.diego); // interviewer on job-be only; the seeded rejection is on job-pd
    const report = await getRejectionReport();
    expect(report.categorised).toBe(0);
  });
});
