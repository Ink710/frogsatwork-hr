// The LEAN, edge-safe half of the candidate portal's Auth.js config. No database imports, so it can
// run in the proxy (Edge runtime, where Prisma cannot go).
//
// ⚠️ THIS IS A SEPARATE REALM FROM @hris/auth, AND THE SEPARATION IS MECHANICAL, NOT NOMINAL.
//
// Decision A gave applicants their own identity table rather than a `Role` on `User`. That is only
// worth anything if a staff session and an applicant session cannot be mistaken for one another —
// and in DEV all four apps share `localhost`, where cookies are per-HOST and ignore the port. Two
// things make the confusion impossible rather than merely unlikely:
//
//   1. A DISTINCT COOKIE NAME. The staff apps use Auth.js's default `authjs.session-token`; this app
//      uses its own, so the two never occupy the same cookie slot and signing into one cannot
//      clobber the other.
//   2. ITS OWN SECRET (CANDIDATE_AUTH_SECRET). Even if a staff cookie were presented under this
//      name, it could not be decrypted here — and an applicant cookie is equally meaningless to the
//      staff apps. The realms are cryptographically separate, not separated by convention.
//
// The session carries { accountId, candidateId, orgId } and NOTHING shaped like a staff Viewer — no
// role, no employeeId. Downstream code cannot accidentally treat one as the other because the shape
// simply isn't there.

const COOKIE_PREFIX = process.env.NODE_ENV === "production" ? "__Secure-" : "";

/** @type {import("next-auth").NextAuthConfig} */
export const candidateAuthConfig = {
  trustHost: true,
  // Where the proxy sends an unauthenticated visitor. NOT /login — that route does not exist in this
  // app; the applicant flow starts by asking for a link.
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  secret: process.env.CANDIDATE_AUTH_SECRET,
  cookies: {
    sessionToken: {
      name: `${COOKIE_PREFIX}candidate-portal.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  providers: [], // the real Credentials provider is added only in auth.js (it needs the DB)
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.accountId = user.id;
        token.candidateId = user.candidateId;
        token.orgId = user.orgId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.accountId;
        session.user.candidateId = token.candidateId;
        session.user.orgId = token.orgId;
      }
      return session;
    },
  },
};
