// The full Node-runtime Auth.js instance. It adds the Credentials provider, whose
// authorize() hits the database and verifies the bcrypt hash. This is what the app's
// route handler, Server Actions, and `auth()` calls use.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@hris/database";
import { authConfig } from "./auth.config.js";

// A fixed, valid bcrypt hash of a random string. When no user (or no password) is found we still run
// one bcrypt.compare against THIS, so a missing email costs the same time as a wrong password —
// otherwise the timing difference leaks which emails exist (user enumeration). It never matches.
const DUMMY_HASH = "$2b$10$JdA64t1s3vFVNH8./0kj2O6O5U06oQvxaZ9VMbALYDt/krmqe..b6";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const rawEmail = credentials?.email;
        const password = credentials?.password;
        if (typeof rawEmail !== "string" || typeof password !== "string") return null;
        // Normalize so "Ana@X.com" and "ana@x.com" resolve to the same account (emails are stored
        // lowercase). Keep this in sync with how users are created.
        const email = rawEmail.trim().toLowerCase();

        // The User table has no RLS, so this lookup works pre-session.
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            orgId: true,
            passwordHash: true,
          },
        });

        // Always run exactly one bcrypt.compare — against the real hash if we have one, else a dummy —
        // so the response time doesn't reveal whether the email exists (constant-time auth).
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user?.passwordHash || !valid) return null;

        // Employee IS under RLS, and there's no session yet, so a normal query would be
        // filtered to nothing. Resolve the id via the SECURITY DEFINER function instead.
        const rows = await prisma.$queryRaw`SELECT app_employee_id_for_user(${user.id}) AS id`;
        const employeeId = rows[0]?.id ?? null;

        // Returned object flows into the jwt() callback as `user`.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          employeeId,
        };
      },
    }),
  ],
});
