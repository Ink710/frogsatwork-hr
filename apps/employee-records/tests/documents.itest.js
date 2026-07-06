import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { prisma } from "@hris/database";
import { withViewer } from "../../../packages/auth/src/rls.js";

const ORG = "10000000-0000-0000-0000-000000000001";
const SYS = "00000000-0000-0000-0000-000000000001";
const V = {
  ana: { userId: "30000000-0000-0000-0000-000000000001", employeeId: "40000000-0000-0000-0000-000000000001", role: "HR_ADMIN", orgId: ORG },
  marcus: { userId: "30000000-0000-0000-0000-000000000002", employeeId: "40000000-0000-0000-0000-000000000002", role: "MANAGER", orgId: ORG },
  diego: { userId: "30000000-0000-0000-0000-000000000004", employeeId: "40000000-0000-0000-0000-000000000004", role: "EMPLOYEE", orgId: ORG },
};
const DIEGO = V.diego.employeeId;
const PRIYA = "40000000-0000-0000-0000-000000000005";
const DOC_D = "d0000000-0000-0000-0000-0000000000d1";
const DOC_P = "d0000000-0000-0000-0000-0000000000p1";

async function ownerExec(sql, params) {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  await c.query(sql, params);
  await c.end();
}

beforeAll(async () => {
  // Seed two documents via the owner (bypasses RLS): one for Diego, one for Priya.
  await ownerExec(
    `INSERT INTO "EmployeeDocument"(id,"documentType","fileName","fileUrl","fileSizeBytes","uploadedById","employeeId","createdAt")
     VALUES ($1,'CONTRACT','d.txt','k/d',1,$3,$4,now()), ($2,'CONTRACT','p.txt','k/p',1,$3,$5,now())
     ON CONFLICT (id) DO NOTHING`,
    [DOC_D, DOC_P, SYS, DIEGO, PRIYA],
  );
});
afterAll(async () => {
  await ownerExec(`DELETE FROM "EmployeeDocument" WHERE id = ANY($1)`, [[DOC_D, DOC_P]]);
  await prisma.$disconnect();
});

const docsFor = (viewer, employeeId) =>
  withViewer(viewer, (tx) => tx.employeeDocument.findMany({ where: { employeeId } }));

describe("EmployeeDocument RLS (list/download visibility)", () => {
  it("an employee sees their OWN documents, not others'", async () => {
    expect(await docsFor(V.diego, DIEGO)).toHaveLength(1);
    expect(await docsFor(V.diego, PRIYA)).toHaveLength(0);
  });

  it("a manager sees a report's documents", async () => {
    expect(await docsFor(V.marcus, DIEGO)).toHaveLength(1);
  });

  it("HR sees documents across the org", async () => {
    const all = await withViewer(V.ana, (tx) => tx.employeeDocument.findMany());
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
