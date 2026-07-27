import { describe, it, expect } from "vitest";
import { timeEntrySchema } from "./index.ts";

describe("timeEntrySchema activity tagging", () => {
  const base = { workDate: "2026-07-27", hours: 8 };

  it("accepts an untagged line, a project-only line, and a meeting-only line", () => {
    expect(timeEntrySchema.safeParse(base).success).toBe(true);
    expect(timeEntrySchema.safeParse({ ...base, projectId: "proj-1" }).success).toBe(true);
    expect(timeEntrySchema.safeParse({ ...base, meetingId: "mtg-1" }).success).toBe(true);
  });

  it("rejects a line tagged to BOTH a project and a meeting", () => {
    const r = timeEntrySchema.safeParse({ ...base, projectId: "proj-1", meetingId: "mtg-1" });
    expect(r.success).toBe(false);
  });
});
