// Where a CANDIDATE goes to see their own applications (M8).
//
// ⚠️ THIS IS NOT `APP_BASE_URL`, AND THE DIFFERENCE MATTERS. The ATS sends most stage
// notifications, and its own APP_BASE_URL points at the ATS — a staff tool behind a login. Linking
// an applicant there would send them to a sign-in page for an account they do not have and must
// never have. The candidate portal is a separate deployment with its own address.
//
// Defaults to the local portal port so development needs no extra configuration. ⚠️ It MUST be set
// in production, or every notification links to localhost — see docs/DEPLOYMENT.md.
export function portalUrl() {
  return `${process.env.PORTAL_BASE_URL ?? "http://localhost:3003"}/portal`;
}
