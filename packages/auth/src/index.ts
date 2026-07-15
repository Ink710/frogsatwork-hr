// Public surface of @hris/auth (Node runtime).
//   import { auth, signIn, signOut, handlers } from "@hris/auth";
export { handlers, auth, signIn, signOut } from "./auth.js";
export { authConfig } from "./auth.config.js";

// Re-exported so the app can catch sign-in failures without depending on next-auth
// directly.
export { AuthError } from "next-auth";

// Authorization surface (Phase B).
export { getViewer } from "./session";
export {
  RECORD_SCOPE,
  getRecordScope,
  canViewCompensation,
  canEditEmployee,
  canEditCompensation,
  canTerminate,
  canRehire,
  canViewBudget,
  canViewBudgetOverview,
  canManageSettings,
  canManageDepartments,
  isPayroll,
  isHrRole,
} from "./roles";
export {
  getSubtreeIds,
  getAncestorIds,
  getDepth,
  getCompContext,
  resolveCompAccess,
} from "./scope";
export { withViewer } from "./rls";

// Type-only surface. `export type` is required under isolatedModules: a single-file
// transpiler (SWC/esbuild) can't tell these are types to be erased, so we mark them.
export type { Viewer, CompTarget, CompContext, RecordScope } from "./roles";
