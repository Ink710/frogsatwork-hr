// Public surface of @hris/auth (Node runtime).
//   import { auth, signIn, signOut, handlers } from "@hris/auth";
export { handlers, auth, signIn, signOut } from "./auth.js";
export { authConfig } from "./auth.config.js";

// Re-exported so the app can catch sign-in failures without depending on next-auth
// directly.
export { AuthError } from "next-auth";
