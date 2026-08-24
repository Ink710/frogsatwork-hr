// Next 16 renamed the "middleware" file convention to "proxy". Runs on every matched request.
import { auth } from "@hris/auth/middleware";

export default auth;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ THIS MATCHER IS THE INVERSE OF THE OTHER THREE APPS. READ BEFORE ADDING A ROUTE.
//
// employee-records, time-management and the ATS all protect EVERYTHING and carve out a handful of
// public paths with a negative lookahead. That is right for them: they are internal tools where a
// new page should require a session by default.
//
// This app is the opposite shape. It is a PUBLIC website — job listings, job detail, and later the
// apply flow — with one private area for an applicant's own data. Expressing that as an exclusion
// list would mean a long, fragile lookahead covering nearly every route in the app, and the mistake
// it invites is the one this suite has already made once: a public asset silently 307ing to /login
// (see the `brand` exclusion the other three apps carry). Here, brand assets are never matched at
// all, so that class of bug cannot occur.
//
// THE RULE THIS CREATES, AND IT IS NOT OPTIONAL:
//   ⇒ EVERY authenticated surface MUST live under /portal.
// A route added outside /portal is PUBLIC. There is no second chance from the matcher.
//
// What bounds that risk: /portal's data does not come from ordinary RLS reads but from a
// SECURITY DEFINER doorway keyed on the session's user id (M5). With no session there is no id, and
// the doorway returns nothing — so a route accidentally left outside /portal still cannot serve
// another person's data. The proxy is the outer gate, not the only one. Do not treat that as
// permission to be careless with where a route lives.
//
// /portal does not exist yet (auth lands in M4). The matcher is here from the start deliberately, so
// the posture is established before the first private page rather than bolted on after it.
// ═════════════════════════════════════════════════════════════════════════════════════════════
export const config = {
  matcher: ["/portal/:path*"],
};
