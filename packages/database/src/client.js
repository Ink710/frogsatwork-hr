// The runtime Prisma client — the single object the whole app imports to talk to
// the database.
//
// Two things worth understanding here:
//
// 1. DRIVER ADAPTER (Prisma 7). Prisma 7 dropped its Rust query engine; the client
//    now talks to Postgres through a plain Node driver (`pg`) wrapped in a Prisma
//    adapter. The connection string comes from DATABASE_URL — the RESTRICTED
//    `hris_app` role, which cannot UPDATE/DELETE the audit log.
//
// 2. SINGLETON. In development, Next.js hot-reloads by re-importing modules on every
//    save. Without care, each reload would run `new PrismaClient()` again and open a
//    fresh connection pool, quickly exhausting Postgres ("too many clients"). So we
//    cache the instance on `globalThis` and reuse it. In production the module is
//    imported once, so the guard is a dev-only concern.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/index.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__hrisPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__hrisPrisma = prisma;
}
