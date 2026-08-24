"use client";

import { useActionState, useState } from "react";
import { useT } from "@hris/ui/client";
import { SOURCE_CHANNELS, slugify } from "@hris/recruiting";
import {
  createCampaign,
  renameCampaign,
  archiveCampaign,
  restoreCampaign,
} from "@/app/(internal)/campaigns/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const BTN = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60";

// One campaign: inline rename, archive/restore, and its slug shown as read-only monospace.
//
// The SLUG IS NOT EDITABLE and the UI says so rather than simply omitting the control — a published
// address that silently changes would break every live tracking link, and those clicks would then
// arrive unrecognised and be recorded as "Unknown", which reads as a campaign that stopped working.
function CampaignRow({ campaign }) {
  const t = useT();
  const [renameState, renameAction, renaming] = useActionState(
    renameCampaign.bind(null, campaign.id),
    undefined,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    async () => (campaign.archivedAt ? restoreCampaign(campaign.id) : archiveCampaign(campaign.id)),
    undefined,
  );
  const error = renameState?.error || toggleState?.error;
  const archived = Boolean(campaign.archivedAt);

  return (
    <li className={`rounded-lg border border-border p-3 ${archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameAction} className="flex flex-1 items-center gap-2">
          <input
            name="name"
            defaultValue={campaign.name}
            required
            className={`${INPUT} flex-1`}
            aria-label={t("campaigns.name")}
          />
          <button type="submit" disabled={renaming} className={BTN}>
            {t("campaigns.rename")}
          </button>
        </form>
        <form action={toggleAction}>
          <button type="submit" disabled={toggling} className={BTN}>
            {archived ? t("campaigns.restore") : t("campaigns.archive")}
          </button>
        </form>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">?source={campaign.slug}</span>
        <span>{t(`enum.sourceChannel.${campaign.channel}`)}</span>
        <span>{t("campaigns.applications", { n: campaign.applications })}</span>
        {archived && <span className="text-foreground">{t("campaigns.archivedPill")}</span>}
      </div>

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function CampaignEditor({ campaigns }) {
  const t = useT();
  const [state, action, pending] = useActionState(createCampaign, undefined);
  // The slug is SUGGESTED from the name and stays editable. Suggesting is a convenience; the value
  // is still validated server-side by the same schema, because what reaches the database can come
  // from anywhere, not just this form.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <div>
      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("campaigns.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map((c) => (
            <CampaignRow key={c.id} campaign={c} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("campaigns.name")}</span>
          <input
            name="name"
            required
            placeholder={t("campaigns.namePlaceholder")}
            className={INPUT}
            onChange={(e) => {
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("campaigns.slug")}</span>
          <input
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="linkedin-march-grads"
            className={`${INPUT} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("campaigns.channel")}</span>
          <select name="channel" defaultValue="OTHER" className={INPUT}>
            {SOURCE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`enum.sourceChannel.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {t("campaigns.add")}
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
