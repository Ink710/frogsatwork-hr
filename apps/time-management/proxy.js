// Next 16 renamed the "middleware" file convention to "proxy". Runs on every matched request.
// Auth.js's `auth` wrapper enforces the `authorized` callback from the edge config — redirecting
// to /login when there's no valid session.
import { auth } from "@hris/auth/middleware";

export default auth;

export const config = {
  // Protect everything EXCEPT the auth API, the public health check, the cron endpoint (guarded by
  // CRON_SECRET, not a session), Next internals, favicon, and /login.
  matcher: ["/((?!api/auth|api/health|api/cron|_next/static|_next/image|favicon.ico|login).*)"],
};
