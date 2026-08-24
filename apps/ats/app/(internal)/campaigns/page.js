import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { Card } from "@hris/ui/server";
import { getT } from "@/lib/i18n.server";
import { getCampaigns, canManageCampaigns } from "@/lib/queries";
import { CampaignEditor } from "@/components/CampaignEditor";

/**
 * The attribution registry (M2) — the known set of places applicants come from.
 *
 * ⚠️ RECRUITERS AND HR ONLY, matching campaign_write. Note this is narrower than who may READ a
 * campaign: campaign_read is org-wide, because the pipeline board, the candidate filter and
 * /reports all have to resolve a campaign name for anyone who can see an application. What is
 * gated here is MAINTAINING the vocabulary, which is a recruiting decision.
 *
 * 404 rather than a message, matching /compliance and the leads pool: a 404 does not confirm the
 * page exists. The database refuses the writes regardless — this only stops the app advertising a
 * door that will not open.
 */
export default async function CampaignsPage() {
  const t = await getT();
  const viewer = await getViewer();
  if (!canManageCampaigns(viewer)) notFound();

  const campaigns = await getCampaigns();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("campaigns.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("campaigns.subtitle")}</p>

      <div className="mt-6">
        <Card title={t("campaigns.listTitle")}>
          <CampaignEditor campaigns={campaigns} />
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">{t("campaigns.slugNote")}</p>
    </main>
  );
}
