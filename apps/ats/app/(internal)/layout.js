import { AppHeader } from "@/components/AppHeader";

// The AUTHENTICATED shell. Everything in this route group sits behind the auth proxy and gets the
// full app header (nav, user chip, sign out).
//
// This exists as a route group specifically so `/careers` — the public careers site — does NOT
// inherit it. The root layout deliberately holds only <html>/<body> and the providers, so internal
// navigation can never appear on a page a stranger might be looking at. (Route groups don't affect
// URLs: `(internal)/jobs/[id]` is still `/jobs/[id]`.)
export default function InternalLayout({ children }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
