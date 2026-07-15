// Public surface of @hris/auth (Node runtime).
//   import { auth, signIn, signOut, handlers } from "@hris/auth";
export { handlers, auth, signIn, signOut } from "./auth.js";
export { authConfig } from "./auth.config.js";

// Re-exported so the app can catch sign-in failures without depending on next-auth
// directly.
export { AuthError } from "next-auth";

// Authorization surface (Phase B).
export { getViewer } from "./session.js";
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
} from "./roles.js";
export {
  getSubtreeIds,
  getAncestorIds,
  getDepth,
  getCompContext,
  resolveCompAccess,
} from "./scope.js";
export { withViewer } from "./rls.js";
