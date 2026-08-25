import { signIn } from "@/lib/auth";

// Redeem the emailed link. A ROUTE HANDLER, not a page — and that is a hard requirement, not a
// style choice.
//
// ⚠️ NEXT ONLY ALLOWS COOKIES TO BE WRITTEN FROM A SERVER ACTION OR A ROUTE HANDLER. Signing in
// means setting the session cookie, so a Server Component page physically cannot do it: the first
// version of this was a page, and it failed with "Cookies can only be modified in a Server Action or
// Route Handler" — AFTER app_redeem_candidate_login had already spent the one-time token. The
// applicant saw "that link didn't work" for a link that had, in fact, just worked. Worth
// remembering: the integration tests could not catch this, because they exercise the database
// function rather than the Auth.js + Next boundary. Only the browser found it.
//
// ⚠️ THE TOKEN IS SPENT ON A GET, which is a deliberate trade: a link in an email works by being
// clicked, so redemption cannot hide behind a POST. What makes it acceptable is that the token is
// single-use, short-lived and useless once spent — the worst a prefetcher can do is burn a link the
// applicant must then re-request.
export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");

  if (token) {
    try {
      // Auth.js signals success by THROWING Next's redirect error, which must travel up to the
      // framework untouched. Everything after this line runs only when sign-in genuinely failed.
      await signIn("credentials", { token, redirectTo: "/portal" });
    } catch (e) {
      if (typeof e?.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) throw e;
      // A genuine failure: unknown, expired, already used, or a closed account. The applicant is
      // told the same thing for all four — which one it was is not information we owe a stranger
      // holding a bad link — but the operator gets the cause.
      console.error("[sign-in] token redemption failed", e);
    }
  }

  return Response.redirect(new URL("/sign-in/invalid", request.url));
}
