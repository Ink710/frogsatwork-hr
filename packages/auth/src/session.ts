// Request-scoped "who is asking" helper. Wraps Auth.js's auth() into the compact viewer
// shape the rest of the system passes around.
import { auth } from "./auth.js";
import type { Viewer } from "./roles";
import type { Role } from "@hris/database";
import type { DefaultSession } from "next-auth";

// Module augmentation for next-auth, kept INLINE (not a standalone .d.ts) so it travels with this
// file to every program that compiles it — including the app, which pulls session.ts in via the
// getViewer import. Our session callback (auth.config.js) copies these custom claims onto
// session.user and pins user.id; without this, session.user would only be { name?, email?, image? }.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      employeeId: string | null;
      role: Role;
      orgId: string;
    } & DefaultSession["user"];
  }
}

// Returns the Viewer for the current request, or null when there is no session. The explicit
// Promise<Viewer | null> return type is what lets every downstream consumer treat the result as
// a real Viewer instead of an inferred `any`.
export async function getViewer(): Promise<Viewer | null> {
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
