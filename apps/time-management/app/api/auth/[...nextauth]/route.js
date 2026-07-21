// Auth.js mounts its sign-in / callback / CSRF endpoints here. The handlers come from
// the full (Node) instance so the Credentials provider's DB lookup works.
import { handlers } from "@hris/auth";

export const { GET, POST } = handlers;
