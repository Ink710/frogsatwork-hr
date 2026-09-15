# @hris/storage

**The suite's swappable object storage.** One three-method interface, several drivers.

```js
import { createStorage } from "@hris/storage";
const storage = createStorage({ resolveBaseDir });   // resolveBaseDir is local-driver only

await storage.put(key, buffer);      // → { key }
await storage.getStream(key);        // → readable stream
await storage.remove(key);           // → void
```

- **Driver comes from `STORAGE_DRIVER`** (default `local`). `local` and `vercel-blob` are
  implemented; `s3` and `r2` are declared and **throw a clear, actionable error** rather than
  silently dropping files.
- **It performs no authorization.** Who may read a file is decided before the call — by RLS on the
  owning row, and by a short-lived signed link in front of the route.
- ⚠️ **In production `STORAGE_DRIVER` must be `vercel-blob`.** Left unset it defaults to `local`,
  uploads *succeed*, and the bytes land on an ephemeral serverless disk. Nothing errors.

**Consumers:** `employee-records` (documents), `ats` (résumés), `candidate-portal` (résumé upload).

📖 **Full contract, the swap procedure, and the known erasure gap:**
[`docs/modules/storage-seam.md`](../../docs/modules/storage-seam.md)

**Tests:** `src/index.test.js` — `pnpm vitest run --project unit packages/storage`
