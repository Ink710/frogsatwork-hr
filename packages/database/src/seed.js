// Seed data for local development and the org-chart / temporal-query demos.
//
// Design goals:
//   - IDEMPOTENT: every write is an `upsert` keyed on a stable id or natural key,
//     so running the seed twice leaves the database in the same state (no dupes).
//   - REALISTIC: a 4-level reporting tree (Ana -> Marcus -> Diego -> Tom) so the
//     org chart looks like a real company, plus one employee with a real promotion
//     in history so point-in-time ("as of date X") queries have something to prove.
//
// The seed runs as the RESTRICTED hris_app role (DATABASE_URL), which is a good
// smoke test that our Step 5 grants are correct.

// Load the root .env BEFORE importing the client (which reads DATABASE_URL at import
// time). Dynamic import guarantees env is populated first, despite ESM hoisting.
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// The seed is an ADMIN task, so it connects as the OWNER (DIRECT_URL) rather than the
// restricted app role. That lets it bypass the Row-Level Security we add later and write
// the full dataset. The app itself always uses the restricted hris_app role.
const { PrismaClient } = await import("./generated/client/index.js");
const { PrismaPg } = await import("@prisma/adapter-pg");
const {
  SYSTEM_USER_ID,
  Role,
  EmploymentStatus,
  EmploymentType,
  FlsaClassification,
  PayFrequency,
  PayBasis,
} = await import("./index.js");

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

// Dev-only password shared by every seeded human user. Obviously never do this in prod.
const DEV_PASSWORD = "password123";

// Stable ids so upserts are deterministic across runs.
const ORG_ID = "10000000-0000-0000-0000-000000000001";
const DEPT = {
  exec: "20000000-0000-0000-0000-000000000001",
  eng: "20000000-0000-0000-0000-000000000002",
  people: "20000000-0000-0000-0000-000000000003",
};

// One place to describe every person. `manager` refers to another key in this map;
// we resolve those into managerId after all employees exist (a manager row must be
// inserted before the report that points at it).
const PEOPLE = {
  ana: {
    userId: "30000000-0000-0000-0000-000000000001",
    empId: "40000000-0000-0000-0000-000000000001",
    number: "E-0001",
    firstName: "Ana",
    lastName: "Okafor",
    email: "ana.okafor@frogsatwork.test",
    role: Role.HR_ADMIN, // top of the tree; can see everyone
    dept: "exec",
    manager: null,
    hireDate: "2019-02-01",
    history: [
      { title: "Chief Executive Officer", type: EmploymentType.FULL_TIME, salary: "320000.00", from: "2019-02-01", to: null },
    ],
  },
  marcus: {
    userId: "30000000-0000-0000-0000-000000000002",
    empId: "40000000-0000-0000-0000-000000000002",
    number: "E-0002",
    firstName: "Marcus",
    lastName: "Lee",
    email: "marcus.lee@frogsatwork.test",
    role: Role.MANAGER,
    dept: "eng",
    manager: "ana",
    hireDate: "2020-06-15",
    history: [
      { title: "Engineering Manager", type: EmploymentType.FULL_TIME, salary: "185000.00", from: "2020-06-15", to: null },
    ],
  },
  bianca: {
    userId: "30000000-0000-0000-0000-000000000003",
    empId: "40000000-0000-0000-0000-000000000003",
    number: "E-0003",
    firstName: "Bianca",
    lastName: "Ross",
    email: "bianca.ross@frogsatwork.test",
    role: Role.HR_GENERALIST,
    dept: "people",
    manager: "ana",
    hireDate: "2021-03-01",
    history: [
      { title: "HR Generalist", type: EmploymentType.FULL_TIME, salary: "92000.00", from: "2021-03-01", to: null },
    ],
  },
  diego: {
    userId: "30000000-0000-0000-0000-000000000004",
    empId: "40000000-0000-0000-0000-000000000004",
    number: "E-0004",
    firstName: "Diego",
    lastName: "Santos",
    email: "diego.santos@frogsatwork.test",
    role: Role.EMPLOYEE,
    dept: "eng",
    manager: "marcus",
    hireDate: "2022-01-10",
    // Two versions: hired as Junior, promoted to Software Engineer a year later.
    // The v1 row is CLOSED (effectiveTo set); v2 is the current open row.
    history: [
      { title: "Junior Software Engineer", type: EmploymentType.FULL_TIME, salary: "78000.00", from: "2022-01-10", to: "2023-04-01" },
      { title: "Software Engineer", type: EmploymentType.FULL_TIME, salary: "112000.00", from: "2023-04-01", to: null, reason: "Promotion" },
    ],
  },
  priya: {
    userId: "30000000-0000-0000-0000-000000000005",
    empId: "40000000-0000-0000-0000-000000000005",
    number: "E-0005",
    firstName: "Priya",
    lastName: "Nair",
    email: "priya.nair@frogsatwork.test",
    role: Role.EMPLOYEE,
    dept: "eng",
    manager: "marcus",
    hireDate: "2022-09-05",
    history: [
      { title: "Software Engineer", type: EmploymentType.FULL_TIME, salary: "118000.00", from: "2022-09-05", to: null },
    ],
  },
  tom: {
    userId: "30000000-0000-0000-0000-000000000006",
    empId: "40000000-0000-0000-0000-000000000006",
    number: "E-0006",
    firstName: "Tom",
    lastName: "Becker",
    email: "tom.becker@frogsatwork.test",
    role: Role.EMPLOYEE,
    dept: "eng",
    manager: "diego", // level 4 of the tree
    hireDate: "2024-07-22",
    history: [
      { title: "Junior Software Engineer", type: EmploymentType.PART_TIME, salary: "64000.00", from: "2024-07-22", to: null },
    ],
  },
  nadia: {
    userId: "30000000-0000-0000-0000-000000000007",
    empId: "40000000-0000-0000-0000-000000000007",
    number: "E-0007",
    firstName: "Nadia",
    lastName: "Cole",
    email: "nadia.cole@frogsatwork.test",
    role: Role.PAYROLL_ADMIN, // sees all comp org-wide, but every view is audited
    dept: "people",
    manager: "ana",
    hireDate: "2021-08-01",
    history: [
      { title: "Payroll Administrator", type: EmploymentType.FULL_TIME, salary: "98000.00", from: "2021-08-01", to: null },
    ],
  },
};

// Current-state profile fields (the profile revamp), keyed like PEOPLE. Kept separate so the
// PEOPLE map stays about identity + reporting + salary history. location/phone/timeZone are the
// ungated sidebar/Employment-card facts; equityNote is comp-sensitive (gated Compensation card).
const PROFILES = {
  ana:    { location: "San Francisco, CA", phone: "+1 415 555 0101", timeZone: "America/Los_Angeles", equityNote: "4-yr cliff · yr 4" },
  marcus: { location: "San Francisco, CA", phone: "+1 415 555 0102", timeZone: "America/Los_Angeles", equityNote: "4-yr cliff · yr 3" },
  bianca: { location: "Austin, TX",        phone: "+1 512 555 0103", timeZone: "America/Chicago",     equityNote: "4-yr cliff · yr 2" },
  diego:  { location: "New York, NY",      phone: "+1 212 555 0104", timeZone: "America/New_York",    equityNote: "4-yr cliff · yr 1" },
  priya:  { location: "New York, NY",      phone: "+1 212 555 0105", timeZone: "America/New_York",    equityNote: "4-yr cliff · yr 1" },
  tom:    { location: "Denver, CO (Remote)", phone: "+1 720 555 0106", timeZone: "America/Denver",    equityNote: null },
  nadia:  { location: "Austin, TX",        phone: "+1 512 555 0107", timeZone: "America/Chicago",     equityNote: "4-yr cliff · yr 2" },
};

// Shared demo cadence so every profile renders a review cycle without per-person noise.
const WORK_SCHEDULE = "Mon–Fri, 09:00–18:00";
const LAST_REVIEW = new Date("2025-01-15");
const NEXT_REVIEW = new Date("2026-01-15");

async function main() {
  // One hash reused for all seeded logins (bcrypt salts internally, so identical
  // passwords still produce distinct hashes were we to hash per-user).
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // 1. Organization (multi-tenancy anchor).
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    // Re-assert the name on every seed so a rebrand propagates to an existing dev DB.
    update: { name: "FrogsAtWork Inc." },
    create: { id: ORG_ID, name: "FrogsAtWork Inc." },
  });

  // 1b. Default storage folder — a generic PLACEHOLDER, not a real path. The old
  //     `${repoRoot}.storage` baked the seeding machine's absolute path into the row, which then
  //     showed up (and leaked) in the deployed app's Settings page. HR sets a real writable path
  //     per environment. `update: {}` so re-seeding never overwrites a folder set in Settings.
  await prisma.appSetting.upsert({
    where: { key: "storageDir" },
    update: {},
    create: { key: "storageDir", value: "/Users/<Your filetree goes here>" },
  });

  // 2. System user — pinned id, attributes automated writes. Not an employee.
  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: { email: "system@frogsatwork.test" },
    create: {
      id: SYSTEM_USER_ID,
      email: "system@frogsatwork.test",
      name: "System",
      role: Role.SYSTEM,
      isSystemUser: true,
      orgId: org.id,
    },
  });

  // 3. Departments (Engineering + People report up to Executive). headUserId is wired
  //    later (step 5b), once the users those FKs point at exist. Budgets live in their own
  //    RLS-protected table (step 3b).
  await prisma.department.upsert({
    where: { id: DEPT.exec },
    update: {},
    create: { id: DEPT.exec, name: "Executive", orgId: org.id },
  });
  for (const [id, name, parent] of [
    [DEPT.eng, "Engineering", DEPT.exec],
    [DEPT.people, "People & Culture", DEPT.exec],
  ]) {
    await prisma.department.upsert({
      where: { id },
      update: {},
      create: { id, name, orgId: org.id, parentDepartmentId: parent },
    });
  }

  // 3b. Department budgets (separate RLS-gated table). Seed runs as owner, which bypasses
  //     RLS, so it can write freely.
  for (const [departmentId, budget] of [
    [DEPT.exec, "1200000.00"],
    [DEPT.eng, "2500000.00"],
    [DEPT.people, "800000.00"],
  ]) {
    await prisma.departmentBudget.upsert({
      where: { departmentId },
      update: { budget },
      create: { departmentId, budget },
    });
  }

  // 4. Users + Employees. Pass 1 creates every user and employee WITHOUT a manager
  //    link, so no row references one that doesn't exist yet.
  for (const [key, p] of Object.entries(PEOPLE)) {
    const profile = PROFILES[key];
    await prisma.user.upsert({
      where: { id: p.userId },
      // passwordHash + emailVerifiedAt in `update` too, so re-seeding an existing DB backfills
      // logins and marks these seeded accounts as already activated (not "invite pending").
      // email + name are re-asserted so a rebrand propagates to existing rows on reseed.
      update: { email: p.email, name: `${p.firstName} ${p.lastName}`, passwordHash, emailVerifiedAt: new Date() },
      create: {
        id: p.userId,
        email: p.email,
        name: `${p.firstName} ${p.lastName}`,
        role: p.role,
        orgId: org.id,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    // Profile-revamp fields go in BOTH create and update so re-seeding an existing dev DB
    // backfills them onto already-seeded rows (same pattern as the user passwordHash above).
    const profileFields = {
      location: profile.location,
      phone: profile.phone,
      timeZone: profile.timeZone,
      workSchedule: WORK_SCHEDULE,
      lastReviewDate: LAST_REVIEW,
      nextReviewDate: NEXT_REVIEW,
      equityNote: profile.equityNote,
    };
    await prisma.employee.upsert({
      where: { id: p.empId },
      update: { ...profileFields, email: p.email },
      create: {
        id: p.empId,
        employeeNumber: p.number,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        employmentStatus: EmploymentStatus.ACTIVE,
        hireDate: new Date(p.hireDate),
        userId: p.userId,
        orgId: org.id,
        departmentId: DEPT[p.dept],
        ...profileFields,
      },
    });
  }

  // 5. Pass 2: wire up the manager links now that all employees exist.
  for (const p of Object.values(PEOPLE)) {
    if (!p.manager) continue;
    await prisma.employee.update({
      where: { id: p.empId },
      data: { managerId: PEOPLE[p.manager].empId },
    });
  }

  // 5b. Department heads (users now exist): Executive→Ana, Engineering→Marcus, People→Bianca.
  for (const [deptId, headUserId] of [
    [DEPT.exec, PEOPLE.ana.userId],
    [DEPT.eng, PEOPLE.marcus.userId],
    [DEPT.people, PEOPLE.bianca.userId],
  ]) {
    await prisma.department.update({ where: { id: deptId }, data: { headUserId } });
  }

  // 6. Employee history (the temporal / SCD-2 rows). Snapshots capture the label as
  //    it was at the time; changedBy is the system user for seeded data.
  for (const p of Object.values(PEOPLE)) {
    const deptName = { exec: "Executive", eng: "Engineering", people: "People & Culture" }[p.dept];
    const managerName = p.manager ? `${PEOPLE[p.manager].firstName} ${PEOPLE[p.manager].lastName}` : null;

    let version = 0;
    for (const h of p.history) {
      version += 1;
      // Versioned comp/role attributes. Full-time salaried roles are overtime-EXEMPT; the
      // one part-timer (Tom) is NON_EXEMPT. All paid semi-monthly on an annual (PER_YEAR) basis.
      const versioned = {
        flsaClassification:
          h.type === EmploymentType.FULL_TIME
            ? FlsaClassification.EXEMPT
            : FlsaClassification.NON_EXEMPT,
        payFrequency: PayFrequency.SEMI_MONTHLY,
        payBasis: PayBasis.PER_YEAR,
      };
      await prisma.employeeHistory.upsert({
        where: { employeeId_version: { employeeId: p.empId, version } },
        update: versioned, // backfill onto existing rows on re-seed
        create: {
          employeeId: p.empId,
          version,
          jobTitle: h.title,
          departmentSnapshot: deptName,
          managerSnapshot: managerName,
          employmentType: h.type,
          salary: h.salary,
          currency: "USD",
          changedFields: version === 1 ? ["initial"] : ["jobTitle", "salary"],
          changeReason: h.reason ?? (version === 1 ? "Initial record" : null),
          effectiveFrom: new Date(h.from),
          effectiveTo: h.to ? new Date(h.to) : null,
          changedById: SYSTEM_USER_ID,
          ...versioned,
        },
      });
    }
  }

  // 7. One emergency contact so that relation isn't empty.
  await prisma.emergencyContact.upsert({
    where: { id: "50000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "50000000-0000-0000-0000-000000000001",
      employeeId: PEOPLE.diego.empId,
      name: "Lucia Santos",
      relationship: "Spouse",
      phone: "+1-555-0142",
      isPrimary: true,
    },
  });

  const counts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    departments: await prisma.department.count(),
    employees: await prisma.employee.count(),
    historyRows: await prisma.employeeHistory.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
