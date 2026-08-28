import { describe, it, expect } from "vitest";
import {
  employmentEntrySchema,
  educationEntrySchema,
  employmentListSchema,
  consentSchema,
  monthToDate,
  dateToMonth,
  MAX_HISTORY_ENTRIES,
  profilePersonSchema,
} from "./application";
import { resumeFileError, RESUME_MAX_BYTES } from "./candidate";

const job = (o = {}) => ({ employer: "Acme", title: "Engineer", startDate: "2022-01", ...o });

describe("employment entries", () => {
  it("accepts a current role with no end month", () => {
    // An empty end month means "still there" — the ordinary state, not missing data.
    expect(employmentEntrySchema.safeParse(job({ endDate: "" })).success).toBe(true);
    expect(employmentEntrySchema.safeParse(job()).success).toBe(true);
  });

  it("rejects an end month BEFORE the start month", () => {
    const r = employmentEntrySchema.safeParse(job({ startDate: "2022-06", endDate: "2022-01" }));
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["endDate"]);
  });

  it("accepts an end month equal to the start month (a one-month job is real)", () => {
    expect(employmentEntrySchema.safeParse(job({ startDate: "2022-06", endDate: "2022-06" })).success).toBe(true);
  });

  it("rejects malformed months, including a 13th one", () => {
    for (const bad of ["2022", "22-01", "2022-13", "2022-00", "March 2022", ""]) {
      expect(employmentEntrySchema.safeParse(job({ startDate: bad })).success, bad).toBe(false);
    }
  });

  it("requires an employer and a title", () => {
    expect(employmentEntrySchema.safeParse(job({ employer: "  " })).success).toBe(false);
    expect(employmentEntrySchema.safeParse(job({ title: "" })).success).toBe(false);
  });

  it("bounds the free-text summary", () => {
    expect(employmentEntrySchema.safeParse(job({ summary: "x".repeat(1001) })).success).toBe(false);
    expect(employmentEntrySchema.safeParse(job({ summary: "x".repeat(1000) })).success).toBe(true);
  });
});

describe("the list cap", () => {
  it("refuses more entries than the cap", () => {
    // A bound on a PUBLIC endpoint, not a product rule: without it one POST can carry any number of
    // rows into the database.
    const many = Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, () => job());
    expect(employmentListSchema.safeParse(many).success).toBe(false);
    expect(employmentListSchema.safeParse(many.slice(0, MAX_HISTORY_ENTRIES)).success).toBe(true);
  });

  it("accepts an empty history — plenty of people have none to declare", () => {
    expect(employmentListSchema.safeParse([]).success).toBe(true);
  });
});

describe("education entries", () => {
  it("allows both dates to be absent", () => {
    expect(educationEntrySchema.safeParse({ institution: "State U", qualification: "BSc" }).success).toBe(true);
  });

  it("still rejects an end before a start when both are given", () => {
    const r = educationEntrySchema.safeParse({
      institution: "State U", qualification: "BSc", startDate: "2020-01", endDate: "2019-01",
    });
    expect(r.success).toBe(false);
  });
});

describe("consent", () => {
  it("requires an explicit true — an unchecked box is a failure, not a silent false", () => {
    expect(consentSchema.safeParse(true).success).toBe(true);
    expect(consentSchema.safeParse(false).success).toBe(false);
    expect(consentSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("month conversion", () => {
  it("anchors a month to the first day, in UTC", () => {
    // UTC on purpose: a CV month has no timezone, and the server's local zone could shift an entry
    // into the previous month.
    expect(monthToDate("2024-03")).toBe("2024-03-01T00:00:00.000Z");
  });

  it("round-trips a stored date back to a month", () => {
    expect(dateToMonth(new Date("2024-03-01T00:00:00.000Z"))).toBe("2024-03");
    expect(dateToMonth(null)).toBe("");
    expect(dateToMonth(undefined)).toBe("");
  });
});

// ── M7: the profile an applicant maintains for themselves ──────────────────────────────────

describe("profilePersonSchema", () => {
  const person = (o = {}) => ({ firstName: "Nora", lastName: "Adeyemi", ...o });

  it("accepts a name with an optional phone", () => {
    expect(profilePersonSchema.parse(person()).firstName).toBe("Nora");
    expect(profilePersonSchema.parse(person({ phone: "+44 20 7946 0000" })).phone).toBe(
      "+44 20 7946 0000",
    );
  });

  it("requires both names", () => {
    expect(profilePersonSchema.safeParse(person({ firstName: "" })).success).toBe(false);
    expect(profilePersonSchema.safeParse(person({ lastName: "  " })).success).toBe(false);
  });

  // ⚠️ THE OMISSION IS THE POINT. Email is the login identity and the per-org dedupe key, so it must
  // not be settable from a profile form. Zod strips unknown keys, so a posted email is DISCARDED
  // rather than rejected — this test is what says that is deliberate.
  it("discards an email even when one is supplied", () => {
    const parsed = profilePersonSchema.parse(person({ email: "someone.else@example.com" }));
    expect(parsed).not.toHaveProperty("email");
  });

  it("discards a note — that belongs to a submission, not to a person", () => {
    expect(profilePersonSchema.parse(person({ note: "hello" }))).not.toHaveProperty("note");
  });
});

describe("resumeFileError", () => {
  const file = (o = {}) => ({ name: "cv.pdf", type: "application/pdf", size: 1024, ...o });

  it("accepts each allowed format", () => {
    expect(resumeFileError(file())).toBeNull();
    expect(resumeFileError(file({ name: "cv.doc", type: "application/msword" }))).toBeNull();
    expect(
      resumeFileError(
        file({
          name: "cv.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBeNull();
  });

  it("treats no file as no error — a CV is optional", () => {
    expect(resumeFileError(null)).toBeNull();
    expect(resumeFileError(undefined)).toBeNull();
    expect(resumeFileError(file({ size: 0 }))).toBeNull();
  });

  it("rejects a file over the cap", () => {
    expect(resumeFileError(file({ size: RESUME_MAX_BYTES + 1 }))).toBe("TOO_LARGE");
    expect(resumeFileError(file({ size: RESUME_MAX_BYTES }))).toBeNull();
  });

  // ⚠️ BOTH claims must pass. Either alone is trivially spoofed: the browser reports the MIME type
  // and the attacker owns the filename, so the check is that two independent claims agree.
  it("rejects a mismatch between the type and the extension", () => {
    expect(resumeFileError(file({ name: "cv.exe" }))).toBe("BAD_TYPE");
    expect(resumeFileError(file({ type: "application/x-msdownload" }))).toBe("BAD_TYPE");
    expect(resumeFileError(file({ name: "cv.pdf.exe" }))).toBe("BAD_TYPE");
  });

  it("is case-insensitive about the extension", () => {
    expect(resumeFileError(file({ name: "CV.PDF" }))).toBeNull();
  });
});

// ── Consent (M14 fix) ────────────────────────────────────────────────────────────────────────
describe("the consent checkbox", () => {
  it("accepts a ticked box and rejects an unticked one", () => {
    expect(consentSchema.safeParse(true).success).toBe(true);
    expect(consentSchema.safeParse(false).success).toBe(false);
    // Modelled as a literal `true`, so an absent value is a failure rather than a silent false.
    expect(consentSchema.safeParse(undefined).success).toBe(false);
  });

  // ⚠️ THE REGRESSION THIS LOCKS. The schema was written with zod v3's `errorMap`, which v4 ignores
  // as an unknown key — so the custom sentence never reached anyone and zod's generic
  // "Invalid literal value" was produced instead. Asserting the TEXT is the only way that failure
  // is visible; `success: false` was true both before and after the fix.
  it("carries its own message, not zod's default", () => {
    const result = consentSchema.safeParse(false);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("Please accept the privacy notice to apply.");
  });
});
