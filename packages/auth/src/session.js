// Request-scoped "who is asking" helper. Wraps Auth.js's auth() into the compact viewer
// shape the rest of the system passes around.
import { auth } from "./auth.js";

// Returns { userId, employeeId, role, orgId } for the current request, or null when there
// is no session. Callers decide what to do with null (a page redirects, a query throws).
export async function getViewer() {
  const session = await auth();
  const u = session?.user;
  if (!u) return null;
  return {
    userId: u.id,
    employeeId: u.employeeId ?? null,
    role: u.role,
    orgId: u.orgId,
  };
}
