"use client";

import { useState } from "react";
import { useT } from "@hris/ui/client";
import { trackingLinks } from "@hris/recruiting";

/**
 * Copyable tracking URLs for one requisition (M10).
 *
 * ⚠️ THE URL IS ALWAYS VISIBLE AND SELECTABLE. `navigator.clipboard` does not exist on insecure
 * origins, so the copy button is a convenience that may simply not work — and a link a recruiter
 * cannot reach because an API was missing is worse than no button at all.
 */
function CopyRow({ label, url, caveat }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Insecure origin, or permission refused. The URL is right there to select by hand.
    }
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          {copied ? t("links.copied") : t("links.copy")}
        </button>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{url}</p>
      {caveat && <p className="mt-1 text-xs text-muted-foreground">{caveat}</p>}
    </li>
  );
}

export function TrackingLinks({ jobId, campaigns, portalBaseUrl, careersBaseUrl, published }) {
  const t = useT();

  // ⚠️ A link to a req that is not OPEN and published 404s for everyone who clicks it —
  // app_public_jobs() gates both front doors. Saying so beats handing out dead URLs.
  if (!published) return <p className="text-sm text-muted-foreground">{t("links.notPublished")}</p>;
  if (campaigns.length === 0) return <p className="text-sm text-muted-foreground">{t("links.noCampaigns")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t("links.hint")}</p>
      {campaigns.map((c) => {
        const links = trackingLinks({ portalBaseUrl, careersBaseUrl, jobId, slug: c.slug });
        const portal = links.find((l) => l.kind === "portal");
        const careers = links.find((l) => l.kind === "careers");
        return (
          <div key={c.id}>
            <p className="text-sm font-medium">
              {c.name}{" "}
              <span className="font-mono text-xs text-muted-foreground">?source={c.slug}</span>
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              <CopyRow label={t("links.portal")} url={portal.url} />
              {/* Both attribute identically — getSourceReport groups by campaign, not by app. What
                  differs is the APPLICANT's experience, so the caveat is the whole reason this one
                  is labelled rather than presented as an equal. */}
              <CopyRow label={t("links.careers")} url={careers.url} caveat={t("links.careersCaveat")} />
            </ul>
          </div>
        );
      })}
    </div>
  );
}
