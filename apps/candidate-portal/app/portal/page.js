import { redirect } from "next/navigation";
import { getApplicant } from "@/lib/auth";
import { getT } from "@/lib/i18n.server";
import { SiteHeader, SiteFooter } from "@/components/site-ui";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata = { title: "Your applications · FrogsAtWorkHR" };

// The private area. M4 gives it a session and a door; M5 gives it content — the applications
// timeline, read through app_applicant_portal().
//
// ⚠️ THE SESSION CHECK HERE IS NOT REDUNDANT WITH THE PROXY. The proxy is an edge-level gate that
// can be bypassed by anything that doesn't traverse it (a direct RSC request, a future route
// mounted outside the matcher, a middleware misconfiguration). Every page under /portal re-checks,
// which is the same "never trust the client for authorization" rule the staff apps follow by
// re-checking roles server-side even when the nav already hid the link.
export default async function PortalPage() {
  const applicant = await getApplicant();
  if (!applicant) redirect("/sign-in");

  const t = await getT();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("portal.title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("portal.placeholder")}</p>
          </div>
          <SignOutButton />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
