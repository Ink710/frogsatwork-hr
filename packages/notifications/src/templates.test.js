import { describe, it, expect } from "vitest";
import { candidateStageEmail, NOTIFICATION_LOCALES } from "./templates.js";
import { APPLICANT_STAGE_VIEW } from "@hris/recruiting";

const base = {
  firstName: "Nora",
  jobTitle: "Senior Backend Engineer",
  portalUrl: "https://portal.example/portal",
};

describe("every notifying stage has copy, in every locale", () => {
  // ⚠️ THE PAIRING GUARD. `notify: true` in @hris/recruiting and the copy here are two halves of one
  // decision, in two packages. Without this, marking a new stage as notifying would produce a send
  // attempt with no template — a silent nothing, or a crash, depending on the caller.
  const notifying = Object.entries(APPLICANT_STAGE_VIEW)
    .filter(([, v]) => v.notify)
    .map(([k]) => k);

  it("covers exactly the stages marked notify", () => {
    expect(notifying.sort()).toEqual(["APPLIED", "INTERVIEW", "OFFER", "REJECTED", "SCREEN"]);
  });

  for (const locale of NOTIFICATION_LOCALES) {
    for (const stageKey of notifying) {
      it(`${locale}/${stageKey} renders a subject and both bodies`, () => {
        const mail = candidateStageEmail({ ...base, stageKey, locale });
        expect(mail).not.toBeNull();
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text).toContain(base.jobTitle);
        expect(mail.text).toContain(base.portalUrl);
        expect(mail.html).toContain("<p>");
        expect(mail.html).toContain(base.portalUrl);
      });
    }
  }
});

describe("a stage with no copy sends nothing", () => {
  it("returns null rather than throwing", () => {
    expect(candidateStageEmail({ ...base, stageKey: "HIRED" })).toBeNull();
    expect(candidateStageEmail({ ...base, stageKey: "WITHDRAWN" })).toBeNull();
    expect(candidateStageEmail({ ...base, stageKey: "MADE_UP" })).toBeNull();
  });
});

describe("locale handling", () => {
  it("uses the candidate's language", () => {
    const es = candidateStageEmail({ ...base, stageKey: "APPLIED", locale: "es" });
    const en = candidateStageEmail({ ...base, stageKey: "APPLIED", locale: "en" });
    expect(es.subject).not.toBe(en.subject);
    expect(es.text).toContain("Hola");
  });

  it("falls back to English for an unknown or missing locale", () => {
    const en = candidateStageEmail({ ...base, stageKey: "APPLIED", locale: "en" });
    expect(candidateStageEmail({ ...base, stageKey: "APPLIED", locale: "fr" }).subject).toBe(en.subject);
    expect(candidateStageEmail({ ...base, stageKey: "APPLIED", locale: null }).subject).toBe(en.subject);
    expect(candidateStageEmail({ ...base, stageKey: "APPLIED" }).subject).toBe(en.subject);
  });
});

// ⚠️ THE GUARDRAIL THAT MATTERS MOST IN THIS FILE.
describe("a rejection never carries the internal reason", () => {
  it("renders only the standard courtesy message", () => {
    for (const locale of NOTIFICATION_LOCALES) {
      const mail = candidateStageEmail({ ...base, stageKey: "REJECTED", locale });
      // The template takes no reason parameter at all, so there is nothing to leak — this asserts
      // the shape stays that way if someone later adds one.
      expect(mail.text).not.toMatch(/skills|mismatch|stronger candidate|compensation/i);
      expect(mail.subject).not.toMatch(/reject/i);
    }
  });

  it("ignores a reason even if a caller passes one", () => {
    const mail = candidateStageEmail({
      ...base,
      stageKey: "REJECTED",
      rejectionReason: "Weak on system design, and rude to the receptionist",
      rejectionCategory: "SKILLS_MISMATCH",
    });
    expect(mail.text).not.toContain("receptionist");
    expect(mail.text).not.toContain("SKILLS_MISMATCH");
    expect(mail.html).not.toContain("receptionist");
  });
});

describe("interpolated values are escaped in the HTML body", () => {
  // firstName is set by the applicant through the profile editor; jobTitle is typed by a recruiter.
  // Neither should be able to inject markup into a message we send.
  it("escapes angle brackets and quotes", () => {
    const mail = candidateStageEmail({
      ...base,
      stageKey: "APPLIED",
      firstName: '<script>alert("x")</script>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
