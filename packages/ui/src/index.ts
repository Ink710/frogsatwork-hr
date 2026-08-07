// @hris/ui — the suite's shared UI layer, so all three apps (employee-records, time-management, ats)
// look and behave like one product.
//
// THREE ENTRY POINTS, on purpose:
//   "@hris/ui"         → this file: pure, environment-agnostic helpers. Safe to import anywhere.
//   "@hris/ui/client"  → "use client" components (theme/locale toggles, menus, providers).
//   "@hris/ui/server"  → server + shared components, and `server-only` modules (makeI18nServer).
//
// The split is what keeps `server-only` code out of client bundles: a single barrel would drag it
// into every consumer and break the build.
export * from "./format";
export * from "./theme";
export * from "./i18n";
