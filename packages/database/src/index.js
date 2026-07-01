// Public surface of @hris/database. Every other package/app imports from here.
//
//   import { prisma, Role, SYSTEM_USER_ID } from "@hris/database";
export { prisma } from "./client.js";

// Re-export the generated enums (Role, EmploymentStatus, ...) and the `Prisma`
// namespace, so consumers never reach into the generated folder directly.
export * from "./generated/client/index.js";

// The system actor. A pinned UUID so history/audit rows created by automated
// processes (imports, workflow engine, seeds) always attribute to the same row,
// and code can reference it without a lookup.
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
