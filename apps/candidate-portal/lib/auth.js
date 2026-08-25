import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@hris/database";
import { candidateAuthConfig } from "./auth.config.js";
import { hashLoginToken } from "./tokens.js";

// The full Node-runtime Auth.js instance for the candidate portal.
//
// The provider is Credentials, but it takes a one-time TOKEN rather than an email + password —
// there is no password in this realm at all. Auth.js's built-in magic-link provider was rejected
// deliberately: it requires a database ADAPTER, which would mean adding Account/Session/
// VerificationToken tables and switching the whole suite's session strategy. This is ~30 lines and
// changes nothing for the other three apps.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...candidateAuthConfig,
  providers: [
    Credentials({
      // `token` is the raw value from the emailed link. It is never stored anywhere — only its hash
      // is compared, and only inside the database.
      credentials: { token: {} },
      async authorize(credentials) {
        const raw = credentials?.token;
        if (typeof raw !== "string" || raw.length === 0) return null;

        // A bare prisma call with NO withViewer, because there is no viewer yet — this IS the moment
        // a session is created. app_redeem_candidate_login is the boundary: it verifies the hash,
        // the expiry and the account's open state, and clears the token, ALL IN ONE ATOMIC
        // STATEMENT. That atomicity is the single-use guarantee — two requests carrying the same
        // link cannot both succeed, because the second one's UPDATE matches no rows.
        const rows = await prisma.$queryRaw`
          SELECT account_id, candidate_id, org_id
          FROM app_redeem_candidate_login(${hashLoginToken(raw)})`;
        const row = rows[0];
        if (!row) return null; // unknown, expired, already used, or the account is closed

        // Flows into the jwt() callback as `user`. Note what is absent: no role, no employeeId,
        // nothing a staff code path could mistake for a Viewer.
        return {
          id: row.account_id,
          candidateId: row.candidate_id,
          orgId: row.org_id,
        };
      },
    }),
  ],
});

/**
 * The current applicant, or null. The candidate portal's equivalent of getViewer() — deliberately a
 * DIFFERENT function with a different shape, so nothing can pass one where the other is expected.
 */
export async function getApplicant() {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u?.candidateId) return null;
  return { accountId: u.id, candidateId: u.candidateId, orgId: u.orgId };
}
