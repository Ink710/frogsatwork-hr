// Public surface of @hris/recruiting — shared ATS domain logic (Zod schemas + pure pipeline rules)
// for the recruiting app. Dependency-light (only zod) so any app in the suite can import it. Grows
// as each recruiting milestone lands.
export * from "./job";
export * from "./candidate";
export * from "./rules";
