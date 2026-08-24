"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { campaignSchema } from "@hris/recruiting";
import { canManageCampaigns } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

// Campaign management (M2) — the attribution registry recruiters maintain.
//
// The app-layer gate here is convenience, NOT the authority: campaign_write RLS enforces the same
// role list at the database, so a stale page or a hand-rolled POST is refused regardless. What the
// check buys is a readable error instead of a policy violation, which is the same division of labour
// as viewerCanManageJob.
//
// Note there is no raw-INSERT workaround like createJob's. That exists because job_read cannot see a
// brand-new row mid-insert, so `INSERT … RETURNING` trips the SELECT policy. campaign_read is a bare
// orgId match, which a new row satisfies immediately — verified in psql before this was written.

// Prisma's unique-constraint error. Surfaced as a real message because a duplicate slug is a
// USER-CORRECTABLE mistake, not an internal fault: two campaigns sharing a slug would make one of
// them permanently unreachable from a tracking link.
function isDuplicateSlug(e) {
  return e?.code === "P2002";
}

export async function createCampaign(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageCampaigns(viewer)) return { error: t("err.notAuthorized") };

  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    channel: formData.get("channel"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const d = parsed.data;

  try {
    await withViewer(viewer, (tx) =>
      tx.campaign.create({
        data: {
          id: randomUUID(),
          name: d.name,
          slug: d.slug,
          channel: d.channel,
          orgId: viewer.orgId,
          createdById: viewer.userId,
        },
      }),
    );
  } catch (e) {
    if (isDuplicateSlug(e)) return { error: t("campaigns.duplicateSlug") };
    return { error: t("campaigns.saveFailed") };
  }

  revalidatePath("/campaigns");
  revalidatePath("/candidates");
  return { ok: true };
}

// Rename only — the SLUG IS NOT EDITABLE, deliberately.
//
// A slug is a published address: it is sitting in job ads, social posts and emails we do not
// control. Changing it silently breaks every live link, and worse, those clicks would then arrive
// with an unrecognised slug and be recorded as "Unknown" — attribution loss that looks like a
// campaign that stopped working. Renaming the LABEL is free because reads prefer the campaign's
// current name, and history keeps its snapshot either way.
//
// A campaign that genuinely needs a different address is a new campaign; archive the old one.
export async function renameCampaign(campaignId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageCampaigns(viewer)) return { error: t("err.notAuthorized") };

  const parsed = campaignSchema.shape.name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    // updateMany, not update: RLS makes a campaign in another org simply invisible, so "nothing
    // matched" is the honest outcome rather than a crash (same reasoning as setLead/setArchived).
    const { count } = await withViewer(viewer, (tx) =>
      tx.campaign.updateMany({ where: { id: campaignId }, data: { name: parsed.data } }),
    );
    if (count === 0) return { error: t("campaigns.notFound") };
  } catch {
    return { error: t("campaigns.saveFailed") };
  }

  revalidatePath("/campaigns");
  revalidatePath("/reports");
  return { ok: true };
}

// Archive / restore. Reversible, which is exactly why it is a timestamp and why the gate is the
// ordinary role check rather than something stronger.
//
// ⚠️ NOT A DELETE, and it must never become one. Applications point at this row, and the report
// prefers the campaign's live name over the application's snapshot — deleting would strip a whole
// campaign's history back to "Unknown". Archiving stops NEW attributions (app_submit_application
// refuses an archived slug) while every application it already produced keeps its credit.
async function setArchived(campaignId, archivedAt) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageCampaigns(viewer)) return { error: t("err.notAuthorized") };

  try {
    const { count } = await withViewer(viewer, (tx) =>
      tx.campaign.updateMany({ where: { id: campaignId }, data: { archivedAt } }),
    );
    if (count === 0) return { error: t("campaigns.notFound") };
  } catch {
    return { error: t("campaigns.saveFailed") };
  }

  revalidatePath("/campaigns");
  revalidatePath("/candidates");
  return { ok: true };
}

export async function archiveCampaign(campaignId) {
  return setArchived(campaignId, new Date());
}

export async function restoreCampaign(campaignId) {
  return setArchived(campaignId, null);
}
