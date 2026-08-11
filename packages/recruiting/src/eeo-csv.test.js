import { describe, it, expect } from "vitest";
import { csvField, csvDocument, summaryCsv, filingCsv } from "./eeo-csv";
import { suppressSmallCells } from "./eeo";

const AT = new Date("2026-08-12T09:00:00.000Z");
const lines = (csv) => csv.trimEnd().split("\r\n");

describe("csvField", () => {
  it("leaves ordinary values alone", () => {
    expect(csvField("PROFESSIONALS")).toBe("PROFESSIONALS");
    expect(csvField(12)).toBe("12");
  });

  it("quotes a value containing a comma, so columns can't shift", () => {
    // "Engineer, Senior" unquoted would silently displace every column after it.
    expect(csvField("Engineer, Senior")).toBe('"Engineer, Senior"');
  });

  it("doubles embedded quotes", () => {
    expect(csvField('He said "no"')).toBe('"He said ""no"""');
  });

  it("quotes newlines", () => {
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("csvDocument", () => {
  it("uses CRLF and a trailing newline, per RFC 4180", () => {
    expect(csvDocument([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });
});

describe("summaryCsv", () => {
  const dimensions = suppressSmallCells([
    { dimension: "gender", value: "FEMALE", responses: 10 },
    { dimension: "gender", value: "MALE", responses: 10 },
    { dimension: "gender", value: "NON_BINARY", responses: 2 },
    { dimension: "gender", value: "DECLINED", responses: 5 },
  ]);

  it("writes SUPPRESSED for a withheld cell — never a blank or a zero", () => {
    // A blank reads as missing data; a zero is a lie. A word makes the rule visible.
    const csv = summaryCsv(dimensions, { generatedAt: AT, minCell: 5 });
    expect(csv).toContain("gender,NON_BINARY,SUPPRESSED");
    expect(csv).not.toContain("gender,NON_BINARY,0");
  });

  it("carries the complementary suppression through to the file", () => {
    const csv = summaryCsv(dimensions, { generatedAt: AT, minCell: 5 });
    expect(csv).toContain("gender,DECLINED,SUPPRESSED");
  });

  it("writes exact counts for cells that clear the threshold", () => {
    const csv = summaryCsv(dimensions, { generatedAt: AT, minCell: 5 });
    expect(csv).toContain("gender,FEMALE,10");
  });

  it("explains the rule in the header", () => {
    expect(summaryCsv(dimensions, { generatedAt: AT, minCell: 5 })).toContain(
      "Groups smaller than 5 are withheld",
    );
  });
});

describe("filingCsv", () => {
  const rows = [
    { jobCategory: "PROFESSIONALS", gender: "FEMALE", ethnicity: "ASIAN", headcount: 4 },
    { jobCategory: "PROFESSIONALS", gender: "MALE", ethnicity: "ASIAN", headcount: 2 },
    { jobCategory: "TECHNICIANS", gender: "FEMALE", ethnicity: "ASIAN", headcount: 1 },
  ];

  it("reports EXACT counts, including ones the summary would withhold", () => {
    // This is the whole reason the filing variant exists: 1 and 2 are below the suppression
    // threshold and appear anyway, because a regulator is entitled to them.
    const csv = filingCsv(rows, { generatedAt: AT });
    expect(csv).toContain("TECHNICIANS,1,0,1");
    expect(csv).toContain("PROFESSIONALS,4,2,6");
  });

  it("labels itself unambiguously as unsuppressed and confidential", () => {
    const csv = filingCsv(rows, { generatedAt: AT });
    expect(csv).toContain("EXACT COUNTS, NOT SUPPRESSED");
    expect(csv).toContain("Do not circulate internally");
  });

  it("adds a totals row that actually adds up", () => {
    const csv = filingCsv(rows, { generatedAt: AT });
    const total = lines(csv).at(-1);
    expect(total).toBe("Total,5,2,7");
  });

  it("surfaces uncategorised requisitions as a row AND a warning, never dropping them", () => {
    const csv = filingCsv([...rows, { jobCategory: null, gender: "MALE", ethnicity: "WHITE", headcount: 3 }], {
      generatedAt: AT,
      uncategorisedJobs: 2,
    });
    expect(csv).toContain("WARNING: 2 requisition(s) have no EEO-1 job category");
    expect(csv).toMatch(/^UNCATEGORISED,/m);
  });

  it("omits the warning when every requisition is categorised", () => {
    expect(filingCsv(rows, { generatedAt: AT })).not.toContain("WARNING");
  });

  it("is byte-identical for the same data, so two exports can be diffed", () => {
    const shuffled = [rows[2], rows[0], rows[1]];
    expect(filingCsv(shuffled, { generatedAt: AT })).toBe(filingCsv(rows, { generatedAt: AT }));
  });

  it("survives an empty dataset without producing a broken grid", () => {
    const csv = filingCsv([], { generatedAt: AT });
    expect(csv).toContain("Job category,Total");
    expect(lines(csv).at(-1)).toBe("Total,0");
  });
});
