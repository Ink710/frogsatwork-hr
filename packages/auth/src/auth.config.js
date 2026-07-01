// The LEAN, edge-safe half of the Auth.js config. It contains NO database imports, so
// it can run in Next's middleware (Edge runtime, where Prisma can't go). Both the
// middleware instance and the full Node instance spread this, so the JWT/session shape
// is identical everywhere.

/** @type {import("next-auth").NextAuthConfig} */
export const authConfig = {
  trustHost: true, // dev: don't require an explicit host allowlist
  pages: { signIn: "/login" },
  session: { strategy: "jwt" }, // Credentials provider requires JWT sessions
  providers: [], // the real Credentials provider is added only in auth.js (needs the DB)
  callbacks: {
    // Runs in middleware for every protected route. Truthy user => allowed; otherwise
    // Auth.js redirects to the signIn page.
    authorized({ auth }) {
      return !!auth?.user;
    },
    // On sign-in, `user` is whatever authorize() returned. Copy our custom claims onto
    // the token, which is what later becomes the session (no DB hit per request).
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.orgId = user.orgId;
        token.employeeId = user.employeeId ?? null;
      }
      return token;
    },
    // Expose those claims to the app via the session object.
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid;
        session.user.role = token.role;
        session.user.orgId = token.orgId;
        session.user.employeeId = token.employeeId ?? null;
      }
      return session;
    },
  },
};
