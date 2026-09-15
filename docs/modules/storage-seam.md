# The storage seam — where uploaded files live

> **Covers:** `packages/storage/src/index.js` · `local.js` · `vercel-blob.js` ·
> `apps/employee-records/lib/storage/index.js` · `apps/ats/lib/sign.js`
> **Anchors:** `packages/storage/src/index.test.js` · `apps/ats/tests/resume.itest.js` ·
> `apps/employee-records/tests/documents.itest.js`
> **Lies if:** a fourth driver ships, the three-method interface grows a method, or
> `STORAGE_DRIVER` stops defaulting to `local`.
> **Last verified:** 2026-09-12

Two apps store binaries — employee documents and candidate résumés — behind **one three-method
interface**. Calling code never knows where the bytes are.

```js
put(key, buffer)   →  { key }
getStream(key)     →  a readable stream
remove(key)        →  void
```

That is the entire surface. Deliberately: every method the interface gains is a method every future
driver must implement.

---

## Why a seam at all

The local filesystem is perfect for development and tests — and **does not work on serverless
hosting**, where the filesystem is ephemeral and read-only. So production needs object storage.
Object storage costs money and the account belongs to whoever runs the app.

So the suite ships the **seam**, fully wired, and leaves the credentials to the operator. Swapping a
provider is one file and no calling-code changes. For a portfolio this keeps the demo free; for a
product it is the difference between "supports S3" and a rewrite.

## Driver status — the asymmetry is honest, not untidy

| Driver | State | Notes |
|--------|-------|-------|
| `local` | **implemented** | default; writes under a resolved base dir |
| `vercel-blob` | **implemented** | private store; what production uses today |
| `s3` | declared, **throws** | fails loudly with instructions |
| `r2` | declared, **throws** | same |

```js
// The unimplemented drivers do not silently drop files:
`Storage driver "s3" is declared but not configured. Implement it in @hris/storage and provide
 STORAGE_BUCKET + AWS credentials, or set STORAGE_DRIVER=local for filesystem storage.`
```

An unknown value throws too, naming the valid set. **The interface claims only what exists** — the
listed-but-throwing drivers advertise the intended shape without pretending to work.

> ⚠️ **In production `STORAGE_DRIVER` must be `vercel-blob`.** Left unset it defaults to `local`,
> uploads *succeed*, and the files land on an ephemeral disk that disappears — the worst failure
> mode available, because nothing errors.

---

## The app-side binding: `resolveBaseDir`

The package does not know where the local driver should write; the app injects it.

```js
// apps/employee-records/lib/storage/index.js
async function resolveBaseDir() {
  const row = await prisma.appSetting.findUnique({ where: { key: "storageDir" } });
  return row?.value || process.env.STORAGE_DIR || path.resolve(process.cwd(), ".storage");
}
export const storage = createStorage({ resolveBaseDir });
```

It is resolved **per call**, not once at module load, so changing the folder in `/settings` takes
effect immediately. That is one indexed lookup per file operation — negligible next to the I/O it
precedes. The fallback chain is a safety net; the seed always writes a `storageDir` row.

> Only the `local` driver uses it. `vercel-blob` ignores it entirely, which is why the resolver is
> allowed to be app-specific rather than part of the interface.

---

## What the seam deliberately does NOT do

**It does not do authorization.** `put`/`getStream`/`remove` take a key and act. Whether *this*
viewer may read *that* file is decided before the call — by RLS on the owning row, and by a
short-lived signed link in front of the route.

```
request → session → signed token bound to (file, user) → RLS on the owning row → storage.getStream(key)
```

> ⚠️ The signed link is **defence in depth, not the gate.** The real authority is RLS. A doc that
> says otherwise invites someone to "simplify" by removing the RLS check because the signature looks
> sufficient. The portal's own `/portal/resume` is deliberately **unsigned** — it can only ever serve
> you your own file, so a signature would add ceremony without adding a boundary.

**It does not model deletion policy.** `remove(key)` deletes. Whether a file *should* be deleted —
retention, erasure — is decided by the caller.

> ⚠️ **Known gap, and it matters commercially.** That erasure removes a candidate's blob from the
> object store has **not been verified end to end** against a real Blob store. Under GDPR this stops
> being a nice-to-have the moment the product is sold: it becomes a representation made to a data
> subject. Verify before any paid launch.

---

## Swapping in a new provider

1. Write `packages/storage/src/<driver>.js` exporting `put` / `getStream` / `remove`.
2. Wire it in `createStorage()` beside the `vercel-blob` branch.
3. Add it to `STORAGE_DRIVERS` if it isn't already listed.
4. Set `STORAGE_DRIVER` and the driver's credentials on **every app that stores files** —
   employee-records and ats.
5. Run `packages/storage/src/index.test.js`, then `resume.itest.js` and `documents.itest.js`.

No calling code changes. That is the whole point of the seam, and the thing to protect when editing it.

> **Migrating existing files is not part of the swap.** Changing the driver changes where *new*
> bytes go; anything already written stays where it is. Plan a copy.

## Read next

- [rls-chain.md](rls-chain.md) — the authorization the seam relies on and does not perform
- [ADR-007](../decisions/007-storage-driver-seam.md) — why the abstraction rather than direct calls
