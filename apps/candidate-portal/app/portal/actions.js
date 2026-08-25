"use server";

import { signOut } from "@/lib/auth";

// Signing out clears THIS realm's cookie only. A staff session in another app on the same host is
// untouched — different cookie name, different secret, different realm.
export async function signOutApplicant() {
  await signOut({ redirectTo: "/" });
}
