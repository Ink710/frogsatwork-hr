// The Edge-runtime Auth.js instance, built from the lean config only — no database imports — so it
// is safe in the proxy. It validates the session cookie and enforces `authorized`; it never signs
// anyone in. Mirrors @hris/auth/edge.js, but for THIS realm.
import NextAuth from "next-auth";
import { candidateAuthConfig } from "./auth.config.js";

export const { auth } = NextAuth(candidateAuthConfig);
