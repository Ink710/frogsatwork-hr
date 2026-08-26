"use client";

import { useSyncExternalStore } from "react";

// The viewer's own IANA zone, or null on the server.
//
// ⚠️ `useSyncExternalStore` rather than an effect that calls setState. React's lint rule rejects the
// effect version (it triggers a cascading render), and this is exactly what the hook is for: a value
// that lives outside React and differs between server and client. The server snapshot is `null`, so
// the first client render matches the HTML and there is no hydration mismatch — a local-time line
// simply appears once React takes over.
//
// Extracted in M11 because BOTH the booked time and the slot picker need it. Nothing in the database
// knows where a candidate is; only their browser does.
const subscribe = () => () => {};
const clientZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

export function useViewerZone() {
  return useSyncExternalStore(subscribe, clientZone, serverZone);
}
