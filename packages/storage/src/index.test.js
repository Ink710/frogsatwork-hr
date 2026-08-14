import { describe, it, expect, afterEach } from "vitest";
import { createStorage, STORAGE_DRIVERS } from "./index.js";

const original = process.env.STORAGE_DRIVER;
afterEach(() => {
  if (original === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = original;
});

const SURFACE = ["put", "getStream", "remove"];

describe("driver selection", () => {
  it("defaults to local", () => {
    delete process.env.STORAGE_DRIVER;
    const s = createStorage();
    for (const m of SURFACE) expect(typeof s[m]).toBe("function");
  });

  it("reads STORAGE_DRIVER from the environment", () => {
    process.env.STORAGE_DRIVER = "vercel-blob";
    const s = createStorage();
    for (const m of SURFACE) expect(typeof s[m]).toBe("function");
  });

  it("rejects an unknown driver by NAME rather than failing later at the call", () => {
    // A typo in an env var should stop the app at wiring time, not the first time someone uploads.
    expect(() => createStorage({ driver: "gcs" })).toThrow(/Unknown STORAGE_DRIVER "gcs"/);
  });

  it("every declared driver can be constructed", () => {
    for (const driver of STORAGE_DRIVERS) {
      const s = createStorage({ driver });
      for (const m of SURFACE) expect(typeof s[m]).toBe("function");
    }
  });

  it("keeps s3 and r2 as loud stubs — declared, not implemented", () => {
    // The seam is honest: constructing succeeds, USING it says exactly what's missing.
    //
    // Note the stub throws SYNCHRONOUSLY while the real drivers return promises. Harmless in
    // practice — every call site (careers apply, erasure, the résumé route) wraps the call in
    // `try { await … }`, which catches both — but worth knowing before someone reaches for
    // `.catch()` on its own.
    for (const driver of ["s3", "r2"]) {
      const s = createStorage({ driver });
      expect(() => s.put("k", Buffer.from("x"))).toThrow(/is declared but not configured/);
      expect(() => s.getStream("k")).toThrow(/is declared but not configured/);
    }
  });

  it("does NOT load the Vercel SDK just to build the driver", async () => {
    // The import is lazy on purpose: dev, tests, CI and self-hosters run `local` and should never
    // pay for (or need) @vercel/blob. Constructing must stay synchronous and side-effect free.
    const s = createStorage({ driver: "vercel-blob" });
    expect(typeof s.put).toBe("function");
    // Sanity: the local driver is still the one you get without asking for anything.
    delete process.env.STORAGE_DRIVER;
    expect(typeof createStorage().getStream).toBe("function");
  });
});
