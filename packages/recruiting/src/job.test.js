import { describe, it, expect } from "vitest";
import { screeningWindowSchema, hasScreeningWindow, formatCallWindow } from "./job";

const ok = (from, to, timeZone = "America/Mexico_City") =>
  screeningWindowSchema.safeParse({ from, to, timeZone }).success;

describe("the screening call window schema", () => {
  it("accepts a complete window", () => {
    expect(ok("09:00", "17:00")).toBe(true);
    expect(ok("00:00", "23:59")).toBe(true);
  });

  // An emptied form is how a recruiter REMOVES a window. If this were a validation error the
  // window could be set once and never cleared.
  it("accepts all three empty — that is 'clear the window', not a mistake", () => {
    expect(screeningWindowSchema.safeParse({ from: "", to: "", timeZone: "" }).success).toBe(true);
  });

  it("refuses a half-set window in every direction", () => {
    expect(screeningWindowSchema.safeParse({ from: "09:00", to: "17:00", timeZone: "" }).success).toBe(false);
    expect(screeningWindowSchema.safeParse({ from: "09:00", to: "", timeZone: "UTC" }).success).toBe(false);
    expect(screeningWindowSchema.safeParse({ from: "", to: "17:00", timeZone: "UTC" }).success).toBe(false);
  });

  it("requires a zero-padded 24-hour clock", () => {
    expect(ok("9:00", "17:00")).toBe(false);
    expect(ok("09:00", "5:00")).toBe(false);
    expect(ok("24:00", "17:00")).toBe(false);
    expect(ok("09:60", "17:00")).toBe(false);
    expect(ok("09:00 AM", "17:00")).toBe(false);
  });

  // Padding is what makes the database's plain text comparison chronological; a schema that
  // accepted "9:00" would quietly hand the CHECK constraint a string it orders wrongly.
  it("orders the day correctly, including the case unpadded strings would break", () => {
    expect(ok("09:00", "10:00")).toBe(true);
    expect(ok("17:00", "09:00")).toBe(false);
    expect(ok("09:00", "09:00")).toBe(false); // zero-length
    expect(ok("09:30", "09:15")).toBe(false); // same hour, earlier minute
    expect(ok("09:15", "09:30")).toBe(true);
  });
});

describe("hasScreeningWindow", () => {
  it("is true only when all three are present", () => {
    expect(hasScreeningWindow({ from: "09:00", to: "17:00", timeZone: "UTC" })).toBe(true);
    expect(hasScreeningWindow({ from: "09:00", to: "17:00", timeZone: null })).toBe(false);
    expect(hasScreeningWindow({})).toBe(false);
    expect(hasScreeningWindow({ from: "", to: "", timeZone: "" })).toBe(false);
  });
});

describe("formatCallWindow", () => {
  it("always names the zone — an unlabelled '9 to 5' means nothing to a candidate abroad", () => {
    expect(formatCallWindow({ from: "09:00", to: "17:00", timeZone: "America/Mexico_City" })).toBe(
      "09:00–17:00 (America/Mexico_City)",
    );
  });

  // ⚠️ THE TRAP THIS LOCKS: the hours are a WALL CLOCK and must never be shifted. The formatter
  // places them on a fixed UTC date and reads them back in UTC, so naming a distant zone changes
  // the LABEL and nothing else. A version that formatted in `timeZone` would print 03:00–11:00 here.
  it("does not convert the hours into the named zone", () => {
    expect(formatCallWindow({ from: "09:00", to: "17:00", timeZone: "Asia/Tokyo" })).toBe(
      "09:00–17:00 (Asia/Tokyo)",
    );
    expect(formatCallWindow({ from: "09:00", to: "17:00", timeZone: "Pacific/Kiritimati" })).toBe(
      "09:00–17:00 (Pacific/Kiritimati)",
    );
  });

  // Matches formatSlotWhen's 24-hour style, so a portal card showing both an interview time and a
  // call window does not read as two different systems. The real callers pass INTL_LOCALE's values
  // ("en-US" / "es-ES"), not the bare tags, so those are the ones that must be right.
  it("stays 24-hour in every locale it ships in", () => {
    for (const locale of ["en", "es", "en-US", "es-ES"]) {
      expect(formatCallWindow({ from: "13:00", to: "17:00", timeZone: "UTC" }, locale), locale).toBe(
        "13:00–17:00 (UTC)",
      );
    }
  });

  // ⚠️ MIDNIGHT IS THE EDGE THE CHECK CONSTRAINT ALLOWS, so it has to render. Some ICU versions
  // print hour-cycle h24 as "24:00" for midnight under `hour12: false`, which would show a window
  // starting at an hour that does not exist.
  it("renders a window that starts at midnight as 00:00, not 24:00", () => {
    for (const locale of ["en", "es", "en-US", "es-ES"]) {
      expect(formatCallWindow({ from: "00:00", to: "23:59", timeZone: "UTC" }, locale), locale).toBe(
        "00:00–23:59 (UTC)",
      );
    }
  });
});
