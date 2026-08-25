"use client";

import { useT } from "@hris/ui/client";
import { signOutApplicant } from "@/app/portal/actions";

export function SignOutButton() {
  const t = useT();
  return (
    <form action={signOutApplicant}>
      <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
        {t("portal.signOut")}
      </button>
    </form>
  );
}
