// Auth.js's own endpoints for THIS realm (session, csrf, callback, signout).
//
// Note the matcher in proxy.js does not cover /api/auth — it only matches /portal — so unlike the
// staff apps there is no exclusion to remember here. Another small dividend of the inverted posture.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
