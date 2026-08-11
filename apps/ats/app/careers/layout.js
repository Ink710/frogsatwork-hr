import Link from "next/link";
import { Logo } from "@hris/ui/client";
import { getT } from "@/lib/i18n.server";

// The public careers site deliberately does NOT use the authenticated AppHeader — no internal nav,
// no user chip, nothing that hints at the recruiting app behind it. Just the brand.
export default async function CareersLayout({ children }) {
  const t = await getT();
  return (
    <>
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3 sm:px-6">
          <Logo href="/careers" />
        </div>
      </header>
      {children}
      {/* The erasure link lives in the footer of every public page, not buried in a privacy policy.
          A right nobody can find is not a right they have. */}
      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-4xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <Link href="/careers/erasure" className="underline underline-offset-2 hover:text-foreground">
            {t("erasure.link")}
          </Link>
        </div>
      </footer>
    </>
  );
}
