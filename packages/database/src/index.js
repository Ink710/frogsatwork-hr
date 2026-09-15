// Public surface of @hris/database. Every other package/app imports from here.
//
//   import { prisma, Role, SYSTEM_USER_ID } from "@hris/database";
export { prisma } from "./client.js";

// Re-export the generated enums and the `Prisma` namespace, so consumers never reach into the
// generated folder directly.
//
// ⚠️ NAMED, NOT `export *`, AND THAT IS DELIBERATE. The generated client is a CommonJS module, so
// its exports only exist at runtime. A star re-export therefore cannot be resolved statically:
// Turbopack warns ("unexpected export *") and injects interop code into EVERY module that imports
// this package — which is essentially every server file in all four apps. The warning printed on
// every single request, burying real ones in the dev log.
//
// So the list is explicit. The cost is that adding a new enum to schema.prisma is not enough on its
// own — you must also add it here, or consumers cannot import it. That is a fair trade for a
// statically analysable public surface, and it matches what this file already claimed to be: a
// curated surface rather than a passthrough.
//
// Anything the generated client exports may be added; these are the seven the suite actually uses.
//
// ⚠️ WHEN CHECKING WHAT IS USED, INCLUDE DYNAMIC IMPORTS. `seed.js` pulls four of these through
// `await import("./index.js")`, which a grep for `^import` does not see — dropping them here made
// the seed fail with `Cannot read properties of undefined`, and therefore every integration test.
export {
  Prisma,
  Role,
  EmploymentStatus,
  EmploymentType,
  FlsaClassification,
  PayFrequency,
  PayBasis,
} from "./generated/client/index.js";

// The system actor. A pinned UUID so history/audit rows created by automated
// processes (imports, workflow engine, seeds) always attribute to the same row,
// and code can reference it without a lookup.
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
