// The middleware (Edge runtime) instance. Built from the lean config only — no DB — so
// it's safe to run at the edge. It only validates the session cookie/JWT and enforces the
// `authorized` callback; it never signs anyone in.
import NextAuth from "next-auth";
import { authConfig } from "./auth.config.js";

export const { auth } = NextAuth(authConfig);
