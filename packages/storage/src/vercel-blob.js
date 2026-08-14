import { Readable } from "node:stream";

// Vercel Blob adapter — the suite's first real cloud driver.
//
// ⚠️ IT MUST BE A **PRIVATE** BLOB STORE, and that is not a detail. A public store hands every file
// a URL that anyone holding it can fetch forever, which would quietly demolish the résumé route's
// whole design: a short-lived link bound to one candidate AND one user, backed by RLS. Private
// stores require authentication on every read and are delivered THROUGH our own function via get(),
// so the three gates in that route remain the only way to the bytes. A store's access mode is fixed
// when it is created, so this cannot be corrected later — see docs/DEPLOYMENT.md Part G.
//
// Requires @vercel/blob >= 2.3 (when private storage landed).
//
// AUTHENTICATION is deliberately absent from this file. On Vercel, connecting the store to the
// project injects OIDC credentials (BLOB_STORE_ID + a short-lived, auto-rotating VERCEL_OIDC_TOKEN)
// which the SDK picks up on its own — so no long-lived secret sits in our env. Outside Vercel the
// SDK falls back to BLOB_READ_WRITE_TOKEN. Either way, nothing to pass here.

// The SDK is loaded LAZILY and memoised. Everything that isn't a Vercel deployment — dev, the test
// suite, CI, and anyone self-hosting with STORAGE_DRIVER=local — never imports it at all.
let sdkPromise;
function sdk() {
  sdkPromise ??= import("@vercel/blob");
  return sdkPromise;
}

const ACCESS = { access: "private" };

export function createVercelBlobStorage() {
  return {
    async put(key, buffer) {
      const { put } = await sdk();
      // The key is used verbatim as the blob pathname. Our keys are server-generated UUIDs, so the
      // SDK's default no-overwrite behaviour can never bite, and addRandomSuffix stays off — the DB
      // stores this exact string and has to be able to find it again.
      await put(key, buffer, ACCESS);
    },

    async getStream(key) {
      const { get } = await sdk();
      const result = await get(key, ACCESS);
      // null (no such blob) or any non-200 is "gone" as far as callers are concerned. The résumé
      // route already catches this and answers 404, which is the same answer it gives for a
      // candidate hidden by RLS or erased — deliberately indistinguishable.
      if (!result || result.statusCode !== 200) {
        throw new Error(`Blob not found: ${key}`);
      }
      // The SDK yields a WEB ReadableStream; this interface is defined in terms of a NODE Readable
      // (that is what LocalStorage returns and what both download routes already convert from).
      // Normalising here keeps ONE contract and leaves the shipped routes untouched.
      return Readable.fromWeb(result.stream);
    },

    async remove(key) {
      const { del } = await sdk();
      await del(key);
    },
  };
}
