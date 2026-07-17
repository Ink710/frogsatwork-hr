// Next 16 renamed the "middleware" file convention to "proxy". Runs on every matched
// request. Auth.js's `auth` wrapper enforces the `authorized` callback from the edge
// config — redirecting to /login when there's no valid session.
import { auth } from "@hris/auth/middleware";

export default auth;

export const config = {
  // Protect everything EXCEPT the auth API, the public health check, Next internals, favicon,
  // /login, and /set-password (the public invite-redemption page — a new hire has no session yet).
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|login|set-password).*)"],
};
