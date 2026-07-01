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

        // The User table has no RLS, so this lookup works pre-session. We resolve the
        // linked employee id here so it can ride along in the JWT.
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            orgId: true,
            passwordHash: true,
            employee: { select: { id: true } },
          },
        });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Returned object flows into the jwt() callback as `user`.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          employeeId: user.employee?.id ?? null,
        };
      },
    }),
  ],
});
