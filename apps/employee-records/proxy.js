// Next 16 renamed the "middleware" file convention to "proxy". Runs on every matched
// request. Auth.js's `auth` wrapper enforces the `authorized` callback from the edge
// config — redirecting to /login when there's no valid session.
import { auth } from "@hris/auth/middleware";

export default auth;

export const config = {
  // Protect everything EXCEPT the auth API, Next internals, favicon, and /login
  // (excluding /login avoids a redirect loop).
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
