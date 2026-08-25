import { describe, it, expect } from "vitest";
import { APPLICATION_STAGES } from "./candidate";
import {
  APPLICANT_STAGE_VIEW,
  UNKNOWN_STAGE_VIEW,
  publicStatusFor,
  buildApplicantTimeline,
} from "./portal";

describe("the exhaustiveness guard", () => {
  // ⚠️ THIS TEST IS THE POINT OF THE WHOLE FILE. The applicant timeline renders internal stage
  // names 1:1, so `ApplicationStage` is part of the PUBLIC surface. Without this, adding a stage
  // would silently appear in every in-flight applicant's timeline — a disclosure decision made by
  // default. With it, adding a stage breaks the build until someone decides what applicants see.
  //
  // The TypeScript Record<ApplicationStage, …> catches this too, but the apps are JavaScript, so
  // types alone would not stop a deploy. This is the half that runs in CI.
  it("has an entry for EVERY application stage", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(APPLICANT_STAGE_VIEW[stage], `no applicant view defined for stage ${stage}`).toBeDefined();
    }
    // …and nothing extra, so a removed stage doesn't leave a stale label behind.
    expect(Object.keys(APPLICANT_STAGE_VIEW).sort()).toEqual([...APPLICATION_STAGES].sort());
  });

  it("marks exactly the terminal stages as terminal", () => {
    const terminal = Object.entries(APPLICANT_STAGE_VIEW)
      .filter(([, v]) => v.terminal)
      .map(([k]) => k)
      .sort();
    expect(terminal).toEqual(["HIRED", "REJECTED", "WITHDRAWN"]);
  });

  it("attaches the closing message ONLY to a rejection", () => {
    // WITHDRAWN is the applicant's own action; "we've decided not to move forward" would be absurd.
    const withMessage = Object.entries(APPLICANT_STAGE_VIEW)
      .filter(([, v]) => v.closingMessage)
      .map(([k]) => k);
    expect(withMessage).toEqual(["REJECTED"]);
  });
});

describe("publicStatusFor", () => {
  it("maps a known stage to its own key", () => {
    expect(publicStatusFor("INTERVIEW").key).toBe("INTERVIEW");
  });

  it("falls back to a NEUTRAL view for an unknown stage, never the raw value", () => {
    // The failure mode this prevents: a future `SKILLS_ASSESSMENT` rendering as a raw enum key on a
    // page strangers read.
    const view = publicStatusFor("SKILLS_ASSESSMENT");
    expect(view).toBe(UNKNOWN_STAGE_VIEW);
    expect(view.key).not.toBe("SKILLS_ASSESSMENT");
  });
});

describe("buildApplicantTimeline", () => {
  const at = (d) => `2026-07-${d}T12:00:00.000Z`;

  it("orders by when things happened", () => {
    const t = buildApplicantTimeline([
      { toStage: "SCREEN", occurredAt: at(20) },
      { toStage: "APPLIED", occurredAt: at(10) },
    ]);
    expect(t.map((e) => e.key)).toEqual(["APPLIED", "SCREEN"]);
  });

  it("COLLAPSES consecutive interview-round advances into one entry", () => {
    // Moving between rounds writes INTERVIEW → INTERVIEW each time. Round names are deliberately
    // never exposed, so two "Interview" rows with two dates would be unexplainable to the reader.
    const t = buildApplicantTimeline([
      { toStage: "APPLIED", occurredAt: at(10) },
      { toStage: "SCREEN", occurredAt: at(14) },
      { toStage: "INTERVIEW", occurredAt: at(21) },
      { toStage: "INTERVIEW", occurredAt: at(24) },
      { toStage: "INTERVIEW", occurredAt: at(26) },
    ]);
    expect(t.map((e) => e.key)).toEqual(["APPLIED", "SCREEN", "INTERVIEW"]);
    // …dated when they REACHED the stage, not when we last touched it.
    expect(t[2].occurredAt).toBe(at(21));
  });

  it("does not collapse a stage that recurs after something else", () => {
    // A reopened application genuinely re-enters a stage; that is real movement, not noise.
    const t = buildApplicantTimeline([
      { toStage: "INTERVIEW", occurredAt: at(10) },
      { toStage: "REJECTED", occurredAt: at(12) },
      { toStage: "INTERVIEW", occurredAt: at(20) },
    ]);
    expect(t.map((e) => e.key)).toEqual(["INTERVIEW", "REJECTED", "INTERVIEW"]);
  });

  it("returns an empty timeline for no events rather than throwing", () => {
    expect(buildApplicantTimeline([])).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const events = [
      { toStage: "SCREEN", occurredAt: at(20) },
      { toStage: "APPLIED", occurredAt: at(10) },
    ];
    buildApplicantTimeline(events);
    expect(events[0].toStage).toBe("SCREEN"); // still in the original order
  });
});
