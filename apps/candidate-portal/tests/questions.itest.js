import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/resetDb.js";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const e = new Error(`REDIRECT:${url}`);
    e.__redirect = url;
    throw e;
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-forwarded-for", "203.0.113.12"]]) }));
vi.mock("@/lib/i18n.server", async () => {
  const { messagesFor } = await import("../lib/messages/index.js");
  const { createTranslator } = await import("@hris/ui");
  const t = createTranslator(messagesFor("en"));
  return { getT: async () => t, getLocale: async () => "en" };
});
vi.mock("@hris/auth", async () => {
  const rls = await import("../../../packages/auth/src/rls");
  return { getViewer: vi.fn(), withViewer: rls.withViewer };
});

import { prisma } from "@hris/database";
import { withViewer } from "@hris/auth";
import { submitApplication } from "../app/jobs/[id]/apply/actions.js";
import { getJobQuestions } from "../lib/queries.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const ANA = {
  userId: "30000000-0000-0000-0000-000000000001",
  employeeId: "40000000-0000-0000-0000-000000000001",
  role: "HR_ADMIN",
  orgId: ORG,
};
const asAna = (fn) => withViewer(ANA, fn);

// Questions are created as HR (they are job-manage writes), then answered anonymously.
async function seedQuestions() {
  await asAna((tx) =>
    tx.$executeRaw`
      INSERT INTO "JobQuestion" (id,prompt,type,required,options,position,"createdAt","updatedAt","jobId") VALUES
       ('q-req','Are you authorised to work here?','YES_NO',true,ARRAY[]::text[],0,now(),now(),'job-be'),
       ('q-opt','Notice period?','SHORT_TEXT',false,ARRAY[]::text[],1,now(),now(),'job-be'),
       ('q-sel','Preferred location?','SINGLE_SELECT',false,ARRAY['Remote','Onsite'],2,now(),now(),'job-be'),
       ('q-arch','Retired question','SHORT_TEXT',false,ARRAY[]::text[],3,now(),now(),'job-be'),
       ('q-other','Portfolio URL?','SHORT_TEXT',false,ARRAY[]::text[],0,now(),now(),'job-pd')`,
  );
  await asAna((tx) => tx.$executeRaw`UPDATE "JobQuestion" SET "archivedAt"=now() WHERE id='q-arch'`);
}

function form(o = {}) {
  const f = new FormData();
  const base = {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
    employment: "[]", education: "[]", consent: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) if (v !== undefined) f.set(k, v);
  return f;
}

async function apply(overrides = {}, jobId = "job-be") {
  try {
    const res = await submitApplication(jobId, null, undefined, form(overrides));
    return res ?? {};
  } catch (e) {
    if (e.__redirect) return { ok: true };
    throw e;
  }
}

const answersFor = (email) =>
  asAna((tx) =>
    tx.applicationAnswer.findMany({
      where: { application: { candidate: { email } } },
      orderBy: { promptSnapshot: "asc" },
      select: { promptSnapshot: true, value: true, questionId: true },
    }),
  );

beforeEach(async () => {
  await resetDb();
  await seedQuestions();
});

describe("the public question list", () => {
  it("shows live questions for a published job, in order", async () => {
    const qs = await getJobQuestions("job-be");
    expect(qs.map((q) => q.id)).toEqual(["q-req", "q-opt", "q-sel"]);
    expect(qs[0].required).toBe(true);
    expect(qs[2].options).toEqual(["Remote", "Onsite"]);
  });

  it("excludes ARCHIVED questions — they explain old answers, they are not asked again", async () => {
    expect((await getJobQuestions("job-be")).map((q) => q.id)).not.toContain("q-arch");
  });

  it("shows nothing for a req that is not advertised", async () => {
    // An unadvertised req's questions must be as invisible as the req itself.
    await asAna((tx) => tx.job.update({ where: { id: "job-be" }, data: { publishedAt: null } }));
    expect(await getJobQuestions("job-be")).toEqual([]);
  });
});

describe("answering", () => {
  it("stores answers with the prompt AS ASKED", async () => {
    expect((await apply({ "answer:q-req": "Yes", "answer:q-opt": "One month" })).ok).toBe(true);

    const answers = await answersFor("ada@example.com");
    expect(answers).toEqual([
      { promptSnapshot: "Are you authorised to work here?", value: "Yes", questionId: "q-req" },
      { promptSnapshot: "Notice period?", value: "One month", questionId: "q-opt" },
    ].sort((a, b) => a.promptSnapshot.localeCompare(b.promptSnapshot)));
  });

  it("stores nothing for an unanswered OPTIONAL question", async () => {
    await apply({ "answer:q-req": "Yes" });
    const answers = await answersFor("ada@example.com");
    expect(answers.map((a) => a.questionId)).toEqual(["q-req"]);
  });

  it("REFUSES a submission missing a required answer, and writes nothing", async () => {
    const res = await apply({ "answer:q-opt": "One month" });
    expect(res.error).toBeTruthy();
    expect(await asAna((tx) => tx.candidate.findFirst({ where: { email: "ada@example.com" } }))).toBeNull();
  });

  it("refuses a multiple-choice answer outside the offered options", async () => {
    const res = await apply({ "answer:q-req": "Yes", "answer:q-sel": "Mars" });
    expect(res.error).toBeTruthy();
  });

  it("refuses a yes/no answer that is neither", async () => {
    expect((await apply({ "answer:q-req": "Maybe" })).error).toBeTruthy();
  });
});

describe("answers that must be discarded", () => {
  it("ignores an answer aimed at ANOTHER job's question", async () => {
    // The app layer drops it (it is not in this job's question list) and the doorway would too.
    await apply({ "answer:q-req": "Yes", "answer:q-other": "SMUGGLED" });
    const answers = await answersFor("ada@example.com");
    expect(answers.map((a) => a.questionId)).toEqual(["q-req"]);
    expect(JSON.stringify(answers)).not.toContain("SMUGGLED");
  });

  it("ignores an answer aimed at an ARCHIVED question", async () => {
    await apply({ "answer:q-req": "Yes", "answer:q-arch": "SMUGGLED" });
    expect(JSON.stringify(await answersFor("ada@example.com"))).not.toContain("SMUGGLED");
  });

  it("the DOORWAY discards them too, independently of the form", async () => {
    // Bypass the app layer entirely — this is what a direct POST amounts to.
    await prisma.$queryRaw`
      SELECT result FROM app_submit_application(
        'job-be','Direct','Poster','direct@example.com',NULL,'careers-page',NULL,NULL,
        NULL,NULL,NULL,NULL,NULL,NULL,NULL,
        ${JSON.stringify([
          { questionId: "q-req", value: "Yes" },
          { questionId: "q-other", value: "SMUGGLED" },
          { questionId: "q-arch", value: "SMUGGLED" },
        ])}::jsonb)`;

    const answers = await answersFor("direct@example.com");
    expect(answers.map((a) => a.questionId)).toEqual(["q-req"]);
  });

  it("the DOORWAY refuses a missing required answer, independently of the form", async () => {
    const [row] = await prisma.$queryRaw`
      SELECT result FROM app_submit_application(
        'job-be','Direct','Poster','direct2@example.com',NULL,'careers-page',NULL,NULL,
        NULL,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb)`;
    expect(row.result).toBe("MISSING_ANSWERS");
    expect(await asAna((tx) => tx.candidate.findFirst({ where: { email: "direct2@example.com" } }))).toBeNull();
  });
});

describe("the prompt snapshot", () => {
  it("does not change when the question is reworded afterwards", async () => {
    await apply({ "answer:q-req": "Yes" });
    await asAna((tx) =>
      tx.jobQuestion.update({ where: { id: "q-req" }, data: { prompt: "COMPLETELY DIFFERENT WORDING" } }),
    );

    const [answer] = await answersFor("ada@example.com");
    expect(answer.promptSnapshot).toBe("Are you authorised to work here?");
  });

  it("survives the question being archived", async () => {
    await apply({ "answer:q-req": "Yes" });
    await asAna((tx) => tx.jobQuestion.update({ where: { id: "q-req" }, data: { archivedAt: new Date() } }));

    const answers = await answersFor("ada@example.com");
    expect(answers).toHaveLength(1);
    expect(answers[0].value).toBe("Yes");
  });
});

describe("erasure", () => {
  it("deletes the answers", async () => {
    await apply({ "answer:q-req": "Yes", "answer:q-opt": "One month" });
    const cand = await asAna((tx) => tx.candidate.findFirst({ where: { email: "ada@example.com" } }));
    expect(await answersFor("ada@example.com")).toHaveLength(2);

    const [res] = await asAna((tx) => tx.$queryRaw`SELECT result FROM app_erase_candidate(${cand.id}, 'test')`);
    expect(res.result).toBe("OK");

    expect(
      await asAna((tx) => tx.applicationAnswer.count({ where: { application: { candidateId: cand.id } } })),
    ).toBe(0);
  });
});
