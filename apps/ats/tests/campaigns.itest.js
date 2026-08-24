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
import {
  createCampaign,
  renameCampaign,
  archiveCampaign,
  restoreCampaign,
} from "../app/(internal)/campaigns/actions.js";
import { getCampaigns, canManageCampaigns, getCandidates, getCandidateFilterOptions, getSourceReport } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const V = {
  raj: { userId: "30000000-0000-0000-0000-000000000008", employeeId: "40000000-0000-0000-0000-000000000008", role: "RECRUITER", orgId: ORG },
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  tom: { userId: "30000000-0000-0000-0000-000000000006", employeeId: "40000000-0000-0000-0000-000000000006", role: "EMPLOYEE", orgId: ORG },
};
const as = (v) => getViewer.mockResolvedValue(v);
const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const names = (r) => r.rows.map((c) => c.name);

// Campaign ids are generated, not fixed: the M2 migration backfills them with uuids on any database
// that already held applications, so the seed resolves them by slug and so must the tests.
const idFor = async (slug) => {
  const c = (await getCampaigns()).find((x) => x.slug === slug);
  if (!c) throw new Error(`no campaign seeded with slug ${slug}`);
  return c.id;
};

beforeEach(async () => {
  await resetDb();
});

describe("who may maintain the registry", () => {
  it("recruiters and HR may; a manager and an employee may not", () => {
    expect(canManageCampaigns(V.raj)).toBe(true);
    expect(canManageCampaigns(V.ana)).toBe(true);
    expect(canManageCampaigns(V.marcus)).toBe(false);
    expect(canManageCampaigns(V.tom)).toBe(false);
    expect(canManageCampaigns(null)).toBe(false);
  });

  it("a manager is refused even if the app-layer gate were bypassed — RLS is the authority", async () => {
    // The action's own check is convenience. Prove the DATABASE refuses by writing as a manager
    // through withViewer directly, which is what a stale page or a hand-rolled POST amounts to.
    await expect(
      withViewer(V.marcus, (tx) =>
        tx.campaign.create({
          data: { id: "camp-sneaky", name: "Sneaky", slug: "sneaky", channel: "OTHER", orgId: ORG, createdById: V.marcus.userId },
        }),
      ),
    ).rejects.toThrow();
  });

  it("but a manager CAN read campaigns — the board and filters need to resolve names", async () => {
    const rows = await withViewer(V.marcus, (tx) => tx.campaign.findMany());
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("campaign CRUD", () => {
  it("creates a campaign a recruiter can then see", async () => {
    as(V.raj);
    const res = await createCampaign(undefined, fd({ name: "Instagram — reels", slug: "instagram-reels", channel: "INSTAGRAM" }));
    expect(res.ok).toBe(true);

    const found = (await getCampaigns()).find((c) => c.slug === "instagram-reels");
    expect(found.channel).toBe("INSTAGRAM");
    expect(found.applications).toBe(0);
  });

  it("refuses a duplicate slug with a correctable message, not a crash", async () => {
    // Two campaigns sharing a slug would make one permanently unreachable from a tracking link.
    as(V.raj);
    const res = await createCampaign(undefined, fd({ name: "Another LinkedIn", slug: "linkedin", channel: "LINKEDIN" }));
    expect(res.error).toBeTruthy();
    expect(res.ok).toBeUndefined();
  });

  it("refuses a malformed slug before it reaches the database", async () => {
    as(V.raj);
    for (const slug of ["../etc", "Has Spaces", "UPPER", "trailing-"]) {
      expect((await createCampaign(undefined, fd({ name: "x", slug, channel: "OTHER" }))).error).toBeTruthy();
    }
  });

  it("refuses creation outright for a manager", async () => {
    as(V.marcus);
    const res = await createCampaign(undefined, fd({ name: "Nope", slug: "nope", channel: "OTHER" }));
    expect(res.error).toBeTruthy();
    expect((await getCampaigns()).some((c) => c.slug === "nope")).toBe(false);
  });

  it("renames a campaign without touching what history says it was called", async () => {
    as(V.raj);
    // app-nora is attributed to camp-linkedin, snapshot "LinkedIn".
    expect((await renameCampaign(await idFor("linkedin"), undefined, fd({ name: "LinkedIn (paid)" }))).ok).toBe(true);

    const app = await withViewer(V.raj, (tx) =>
      tx.application.findUnique({ where: { id: "app-nora" }, select: { source: true, campaign: { select: { name: true } } } }),
    );
    expect(app.campaign.name).toBe("LinkedIn (paid)"); // the FK sees the new name…
    expect(app.source).toBe("LinkedIn"); // …the snapshot still says what it was called then
  });
});

describe("archiving", () => {
  it("keeps the applications a campaign already produced", async () => {
    as(V.raj);
    const linkedin = await idFor("linkedin");
    const before = (await getCampaigns()).find((c) => c.id === linkedin).applications;
    expect(before).toBeGreaterThan(0);

    expect((await archiveCampaign(linkedin)).ok).toBe(true);
    const after = (await getCampaigns()).find((c) => c.id === linkedin);
    expect(after.archivedAt).not.toBeNull();
    expect(after.applications).toBe(before); // archiving is not a delete
  });

  it("drops an archived campaign from the filter options, since it can produce nothing new", async () => {
    as(V.raj);
    await archiveCampaign(await idFor("linkedin"));
    const { campaigns } = await getCandidateFilterOptions();
    expect(campaigns.some((c) => c.slug === "linkedin")).toBe(false);
  });

  it("is reversible", async () => {
    as(V.raj);
    const linkedin = await idFor("linkedin");
    await archiveCampaign(linkedin);
    expect((await restoreCampaign(linkedin)).ok).toBe(true);
    expect((await getCampaigns()).find((c) => c.id === linkedin).archivedAt).toBeNull();
  });

  it("still LISTS archived campaigns on the registry page", async () => {
    // Hiding them would strand attribution nobody can explain — the same reasoning that keeps
    // archived leads in the leads pool.
    as(V.raj);
    const linkedin = await idFor("linkedin");
    await archiveCampaign(linkedin);
    expect((await getCampaigns()).some((c) => c.id === linkedin)).toBe(true);
  });
});

describe("reports and filters read through the registry", () => {
  it("rolls two LinkedIn campaigns into one channel row", async () => {
    // Nora is on "LinkedIn", Owen's backend application on "LinkedIn — March grads": two campaign
    // rows, one channel. This is the question a campaign-only registry could not answer.
    as(V.raj);
    const { campaigns, channels } = await getSourceReport();

    expect(campaigns.find((c) => c.source === "LinkedIn").applications).toBe(1);
    expect(campaigns.find((c) => c.source === "LinkedIn — March grads").applications).toBe(1);
    expect(channels.find((c) => c.channel === "LINKEDIN").applications).toBe(2);

    // Totals reconcile across both views — the roll-up must not invent or lose an application.
    const campaignTotal = campaigns.reduce((n, c) => n + c.applications, 0);
    const channelTotal = channels.reduce((n, c) => n + c.applications, 0);
    expect(channelTotal).toBe(campaignTotal);
  });

  it("filters candidates by campaign SLUG", async () => {
    as(V.raj);
    expect(names(await getCandidates({ source: "linkedin-march-grads" }))).toEqual(["Owen Zhang"]);
    expect(names(await getCandidates({ source: "linkedin" }))).toEqual(["Nora Adeyemi"]);
  });

  it("keeps matching after a rename, because the filter follows the FK not the label", async () => {
    as(V.raj);
    await renameCampaign(await idFor("linkedin"), undefined, fd({ name: "LinkedIn (paid)" }));
    expect(names(await getCandidates({ source: "linkedin" }))).toEqual(["Nora Adeyemi"]);
  });

  it("still ANDs the campaign filter inside ONE application (the M1 lesson)", async () => {
    // Owen: LinkedIn — March grads @ SCREEN (backend), Referral @ REJECTED (design). Neither
    // application is both, so this must find nobody.
    as(V.raj);
    expect(names(await getCandidates({ source: "linkedin-march-grads", stage: "REJECTED" }))).toEqual([]);
    expect(names(await getCandidates({ source: "linkedin-march-grads", stage: "SCREEN" }))).toEqual(["Owen Zhang"]);
  });
});
