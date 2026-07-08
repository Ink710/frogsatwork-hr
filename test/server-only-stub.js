// No-op stub for the `server-only` guard package under Vitest. In a real build Next
// resolves `server-only` to a no-op via the "react-server" export condition; in a bare
// Node/Vitest run it would resolve to the throwing `default` export. Aliasing it here lets
// server modules (lib/invite.js, lib/email.js) be imported by tests without tripping the guard.
export {};
