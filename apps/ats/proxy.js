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
  // assumption that the caller is anonymous and hostile — reads go through app_public_jobs() and the
  // single write goes through app_submit_application(), both SECURITY DEFINER boundaries. Adding a
  // route under /careers means adding it to that threat model.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|login|brand|careers).*)"],
};
