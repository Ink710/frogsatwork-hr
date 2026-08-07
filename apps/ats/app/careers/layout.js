import { Logo } from "@hris/ui/client";

// The public careers site deliberately does NOT use the authenticated AppHeader — no internal nav,
// no user chip, nothing that hints at the recruiting app behind it. Just the brand.
export default function CareersLayout({ children }) {
  return (
    <>
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3 sm:px-6">
          <Logo href="/careers" />
        </div>
      </header>
      {children}
    </>
  );
}
