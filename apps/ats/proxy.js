// Next 16 renamed the "middleware" file convention to "proxy". Runs on every matched request.
// Auth.js's `auth` wrapper enforces the `authorized` callback from the edge config — redirecting
// to /login when there's no valid session.
import { auth } from "@hris/auth/middleware";

export default auth;

export const config = {
  // Protect everything EXCEPT the auth API, the public health check, Next internals, favicon,
  // /login, /brand (public logo artwork — it must serve without a session, e.g. on the login page,
  // or the middleware 307s the image requests to /login and the Logo falls back to the glyph), and
  // **/careers — the public careers site**.
  //
  // That last exclusion is the switch that opens this app to the open internet: without it every
  // careers request 307s to /login. Everything reachable under /careers is therefore written on the
  // assumption that the caller is anonymous and hostile — reads go through app_public_jobs(), and
  // the writes go through app_submit_application() and app_request_erasure(), all SECURITY DEFINER
  // boundaries. Adding a route under /careers means adding it to that threat model.
  //
  // M10 added /careers/erasure under this same exclusion. It is the most sensitive of the three,
  // because the question it is asked ("do you hold data for this address?") is one it must never
  // answer — hence the always-'OK' return and the identical confirmation page for every outcome.
  //
  // `api/cron` is excluded for M11's retention sweep. It is NOT unprotected: the route authenticates
  // with CRON_SECRET and a constant-time compare, and fails closed when no secret is configured.
  // Without this exclusion the proxy would 307 every scheduled request to /login and the sweep would
  // silently never run — a scheduled job that fails by doing nothing is the worst kind.
  matcher: ["/((?!api/auth|api/health|api/cron|_next/static|_next/image|favicon.ico|login|brand|careers).*)"],
};
