// The full Node-runtime Auth.js instance. It adds the Credentials provider, whose
// authorize() hits the database and verifies the bcrypt hash. This is what the app's
// route handler, Server Actions, and `auth()` calls use.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@hris/database";
import { authConfig } from "./auth.config.js";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

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
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

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
