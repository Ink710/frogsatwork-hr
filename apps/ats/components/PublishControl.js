"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { setJobPublished } from "@/app/(internal)/jobs/actions";

// Posting a req publicly is its own act, separate from opening it internally.
export function PublishControl({ jobId, publishedAt, isOpen }) {
  const t = useT();
  const published = Boolean(publishedAt);
  const [state, action, pending] = useActionState(setJobPublished.bind(null, jobId, !published), undefined);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {published ? t("jobForm.published") : t("jobForm.notPublished")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("jobForm.publishHint")}</p>
        </div>
        <form action={action}>
          <button
            type="submit"
            disabled={pending}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
              published ? "border-border hover:bg-muted" : "border-primary/40 text-primary hover:bg-primary/10"
            }`}
          >
            {published ? t("jobForm.unpublish") : t("jobForm.publish")}
          </button>
        </form>
      </div>
      {/* A published-but-not-OPEN req isn't reachable publicly; say so rather than let it look live. */}
      {published && !isOpen && (
        <p className="mt-2 text-xs text-warning">{t("jobForm.publishHint")}</p>
      )}
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
