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
  raj: {
    userId: "30000000-0000-0000-0000-000000000008",
    empId: "40000000-0000-0000-0000-000000000008",
    number: "E-0008",
    firstName: "Raj",
    lastName: "Patel",
    email: "raj.patel@frogsatwork.test",
    role: Role.RECRUITER, // ATS: org-wide recruiting access; per-job scope is via JobMember + RLS
    dept: "people",
    manager: "ana",
    hireDate: "2023-05-15",
    history: [
      { title: "Technical Recruiter", type: EmploymentType.FULL_TIME, salary: "95000.00", from: "2023-05-15", to: null },
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
  raj:    { location: "Remote (US)",       phone: "+1 512 555 0108", timeZone: "America/Chicago",     equityNote: null },
};

// Shared demo cadence so every profile renders a review cycle without per-person noise.
const WORK_SCHEDULE = "Mon–Fri, 09:00–18:00";
const LAST_REVIEW = new Date("2025-01-15");
const NEXT_REVIEW = new Date("2026-01-15");

// Campaign ids keyed by slug, read back from the database (M2).
//
// Read rather than assumed, because the M2 migration BACKFILLS campaigns with generated uuids on any
// database that already held applications — so the ids this seed's fixtures need cannot be hardcoded.
// The slug is the natural key (it carries the unique constraint), so it is what everything looks up by.
async function campaignIdsBySlug() {
  const rows = await prisma.campaign.findMany({ select: { id: true, slug: true } });
  return Object.fromEntries(rows.map((c) => [c.slug, c.id]));
}

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

  // 8. Leave policies (accrual config) — one per (org, leave type). Rates read like a real US PTO
  //    plan (VACATION ≈ 20 days/yr, SICK ≈ 10, PERSONAL ≈ 5); UNPAID never accrues. Idempotent on
  //    the (orgId, type) unique key.
  const LEAVE_POLICIES = [
    { type: "VACATION", accrualHoursPerMonth: "13.34", maxBalanceHours: "240.00", accrues: true },
    { type: "SICK",     accrualHoursPerMonth: "6.67",  maxBalanceHours: "120.00", accrues: true },
    { type: "PERSONAL", accrualHoursPerMonth: "3.33",  maxBalanceHours: "60.00",  accrues: true },
    { type: "UNPAID",   accrualHoursPerMonth: "0.00",  maxBalanceHours: null,     accrues: false },
  ];
  for (const pol of LEAVE_POLICIES) {
    await prisma.leavePolicy.upsert({
      where: { orgId_type: { orgId: org.id, type: pol.type } },
      update: { accrualHoursPerMonth: pol.accrualHoursPerMonth, maxBalanceHours: pol.maxBalanceHours, accrues: pol.accrues },
      create: { orgId: org.id, ...pol },
    });
  }

  // 9. Opening leave balances (OPENING ledger entries) so every employee shows a real balance.
  //    Only the three accruing types get a starting balance. Readable, stable ids (the id column
  //    is TEXT) → upsert-on-id is idempotent even though OPENING rows have a NULL accrualPeriod.
  const OPENING_BALANCES = { VACATION: "80.00", SICK: "40.00", PERSONAL: "16.00" };
  const OPENING_DATE = new Date("2026-01-01");
  for (const p of Object.values(PEOPLE)) {
    for (const [type, hours] of Object.entries(OPENING_BALANCES)) {
      const id = `led-open-${p.number}-${type}`;
      await prisma.leaveLedgerEntry.upsert({
        where: { id },
        update: { hours },
        create: {
          id, employeeId: p.empId, type, hours, source: "OPENING",
          note: "Opening balance", effectiveDate: OPENING_DATE, createdById: SYSTEM_USER_ID,
        },
      });
    }
  }

  // 10. Sample requests for Diego so the queue + history aren't empty: one APPROVED (with its
  //     matching USAGE ledger row, reviewed by his manager Marcus) and one PENDING (for Marcus to
  //     act on in the approvals demo). Idempotent on readable ids.
  await prisma.leaveRequest.upsert({
    where: { id: "req-diego-approved" },
    update: {},
    create: {
      id: "req-diego-approved", employeeId: PEOPLE.diego.empId, type: "VACATION",
      startDate: new Date("2026-03-16"), endDate: new Date("2026-03-18"), hours: "24.00",
      status: "APPROVED", reason: "Spring trip", decisionNote: "Approved — enjoy!",
      reviewedById: PEOPLE.marcus.userId, reviewedAt: new Date("2026-03-01"),
      createdById: PEOPLE.diego.userId,
    },
  });
  await prisma.leaveLedgerEntry.upsert({
    where: { id: "led-usage-diego-approved" },
    update: {},
    create: {
      id: "led-usage-diego-approved", employeeId: PEOPLE.diego.empId, type: "VACATION",
      hours: "-24.00", source: "USAGE", note: "Spring trip",
      effectiveDate: new Date("2026-03-16"), leaveRequestId: "req-diego-approved",
      createdById: PEOPLE.marcus.userId,
    },
  });
  await prisma.leaveRequest.upsert({
    where: { id: "req-diego-pending" },
    update: {},
    create: {
      id: "req-diego-pending", employeeId: PEOPLE.diego.empId, type: "PERSONAL",
      startDate: new Date("2026-08-10"), endDate: new Date("2026-08-10"), hours: "8.00",
      status: "PENDING", reason: "Family matter", createdById: PEOPLE.diego.userId,
    },
  });

  // 11. A sample SUBMITTED weekly timesheet for Tom (PART_TIME → NON_EXEMPT, so overtime applies).
  //     Week of Mon 2026-07-13; two 10h days → daily overtime is visible in the demo. Idempotent.
  await prisma.timesheet.upsert({
    where: { id: "ts-tom-0713" },
    update: {},
    create: {
      id: "ts-tom-0713",
      employeeId: PEOPLE.tom.empId,
      periodStart: new Date("2026-07-13"), // Monday
      periodEnd: new Date("2026-07-19"), // Sunday
      status: "SUBMITTED",
      submittedAt: new Date("2026-07-20"),
    },
  });
  const TOM_ENTRIES = [
    ["2026-07-13", "10.00"],
    ["2026-07-14", "10.00"],
    ["2026-07-15", "8.00"],
    ["2026-07-16", "8.00"],
    ["2026-07-17", "8.00"],
  ];
  for (const [i, [date, hours]] of TOM_ENTRIES.entries()) {
    await prisma.timeEntry.upsert({
      where: { id: `te-tom-0713-${i}` },
      update: { hours },
      create: { id: `te-tom-0713-${i}`, timesheetId: "ts-tom-0713", employeeId: PEOPLE.tom.empId, workDate: new Date(date), hours },
    });
  }

  // 12. A PUBLISHED week of Engineering shifts (week of Mon 2026-07-20) so employees see a posted
  //     department schedule. Includes one OPEN (unassigned) shift. Built by Marcus (Eng manager).
  //     Times are UTC (date + wall-clock). Idempotent on readable ids.
  // Demo timezone: shifts + punches are stored as true UTC instants built from wall-clock in this
  // zone, so they display naturally (09:00 etc.) for a viewer in it. Keep in sync with the app's
  // DEFAULT_TIME_ZONE (apps/time-management/lib/timezone.js). zonedToUtc mirrors zonedWallClockToUtc
  // in @hris/workable-hours (inlined so the seed keeps no app dependency).
  const DEMO_TIME_ZONE = "America/Mexico_City";
  const zonedToUtc = (date, time, timeZone = DEMO_TIME_ZONE) => {
    const [y, mo, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(guess))
        .map((x) => [x.type, x.value]),
    );
    const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess - (wallAsUtc - guess));
  };

  const SHIFTS = [
    { id: "sh-eng-0720-1", emp: PEOPLE.diego.empId, date: "2026-07-20", start: "09:00", end: "17:00", role: "Engineering" },
    { id: "sh-eng-0720-2", emp: PEOPLE.diego.empId, date: "2026-07-21", start: "09:00", end: "17:00", role: "Engineering" },
    { id: "sh-eng-0720-3", emp: PEOPLE.diego.empId, date: "2026-07-22", start: "09:00", end: "17:00", role: "Engineering" },
    { id: "sh-eng-0720-4", emp: PEOPLE.priya.empId, date: "2026-07-23", start: "09:00", end: "17:00", role: "Engineering" },
    { id: "sh-eng-0720-5", emp: PEOPLE.priya.empId, date: "2026-07-24", start: "09:00", end: "17:00", role: "Engineering" },
    { id: "sh-eng-0720-6", emp: PEOPLE.tom.empId, date: "2026-07-20", start: "10:00", end: "14:00", role: "Support" },
    { id: "sh-eng-0720-7", emp: null, date: "2026-07-22", start: "13:00", end: "17:00", role: "On-call" }, // OPEN
  ];
  for (const s of SHIFTS) {
    await prisma.shift.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        departmentId: DEPT.eng,
        employeeId: s.emp,
        startAt: zonedToUtc(s.date, s.start),
        endAt: zonedToUtc(s.date, s.end),
        role: s.role,
        published: true,
        createdById: PEOPLE.marcus.userId,
      },
    });
  }

  // 13. Attendance punches (M4). ClockEvents are the event ledger; worked hours + schedule variance
  //     are DERIVED at read time, so we only seed raw punches. These are tied to the week-07-20
  //     Engineering shifts above so the variance badges render:
  //       - Diego 07-20: in 09:20 (past the grace) / out 17:05        → LATE
  //       - Tom   07-20: in 10:00 / out 13:00 (3h of a 4h shift)      → SHORT
  //       - Priya 07-23: in 09:00, no OUT                             → OPEN (the "forgot to clock
  //         out" case — demoes the HR/manager correction).
  //     Diego is deliberately left with NO punch on 2026-07-21 so a fresh self clock-in demos cleanly.
  //     `createdById` is the employee's own user (a self / WEB punch). Idempotent on readable ids.
  const CLOCK_EVENTS = [
    { id: "ce-diego-0720-in", emp: PEOPLE.diego.empId, by: PEOPLE.diego.userId, type: "IN", date: "2026-07-20", time: "09:20" },
    { id: "ce-diego-0720-out", emp: PEOPLE.diego.empId, by: PEOPLE.diego.userId, type: "OUT", date: "2026-07-20", time: "17:05" },
    { id: "ce-tom-0720-in", emp: PEOPLE.tom.empId, by: PEOPLE.tom.userId, type: "IN", date: "2026-07-20", time: "10:00" },
    { id: "ce-tom-0720-out", emp: PEOPLE.tom.empId, by: PEOPLE.tom.userId, type: "OUT", date: "2026-07-20", time: "13:00" },
    { id: "ce-priya-0723-in", emp: PEOPLE.priya.empId, by: PEOPLE.priya.userId, type: "IN", date: "2026-07-23", time: "09:00" },
  ];
  for (const c of CLOCK_EVENTS) {
    await prisma.clockEvent.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        employeeId: c.emp,
        createdById: c.by,
        type: c.type,
        source: "WEB",
        at: zonedToUtc(c.date, c.time),
      },
    });
  }

  // 14. Projects (M8) — assignment-based. Marcus (Eng manager) creates two projects and assigns his
  //     reports; an employee's timesheet picker only shows projects they're assigned to. Tom's seeded
  //     timesheet entries are tagged to "Mobile App" so the picker + reports have real data.
  const PROJECTS = [
    { id: "proj-plat", name: "Platform Rewrite", code: "PLAT" },
    { id: "proj-mob", name: "Mobile App", code: "MOB" },
  ];
  for (const p of PROJECTS) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name, code: p.code },
      create: { id: p.id, name: p.name, code: p.code, status: "ACTIVE", orgId: ORG_ID, createdById: PEOPLE.marcus.userId },
    });
  }
  const ASSIGNMENTS = [
    { id: "pa-plat-diego", project: "proj-plat", emp: PEOPLE.diego.empId },
    { id: "pa-plat-priya", project: "proj-plat", emp: PEOPLE.priya.empId },
    { id: "pa-mob-diego", project: "proj-mob", emp: PEOPLE.diego.empId },
    { id: "pa-mob-tom", project: "proj-mob", emp: PEOPLE.tom.empId },
  ];
  for (const a of ASSIGNMENTS) {
    await prisma.projectAssignment.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, projectId: a.project, employeeId: a.emp, assignedById: PEOPLE.marcus.userId },
    });
  }
  // Tag Tom's submitted-week entries to the Mobile App project (he's assigned to it).
  await prisma.timeEntry.updateMany({
    where: { timesheetId: "ts-tom-0713" },
    data: { projectId: "proj-mob" },
  });

  // 15. Meetings (M10) — recurring weekly activities, assignment-based like projects. Marcus programs
  //     two meetings for his Engineering reports; each surfaces on their timesheet as a selectable
  //     activity with a suggested duration on its weekday. dayOfWeek: 0=Sun … 6=Sat (getUTCDay).
  const MEETINGS = [
    { id: "mtg-kickstart", name: "Week Kickstart", dayOfWeek: 1, startTime: "09:00", endTime: "09:30" }, // Mon
    { id: "mtg-eng-sync", name: "Engineering Sync", dayOfWeek: 3, startTime: "14:00", endTime: "15:00" }, // Wed
  ];
  for (const m of MEETINGS) {
    await prisma.meeting.upsert({
      where: { id: m.id },
      update: { name: m.name, dayOfWeek: m.dayOfWeek, startTime: m.startTime, endTime: m.endTime },
      create: { id: m.id, ...m, status: "ACTIVE", orgId: ORG_ID, createdById: PEOPLE.marcus.userId },
    });
  }
  const MEETING_ASSIGNMENTS = [
    { id: "ma-kickstart-diego", meeting: "mtg-kickstart", emp: PEOPLE.diego.empId },
    { id: "ma-kickstart-priya", meeting: "mtg-kickstart", emp: PEOPLE.priya.empId },
    { id: "ma-kickstart-tom", meeting: "mtg-kickstart", emp: PEOPLE.tom.empId },
    { id: "ma-sync-diego", meeting: "mtg-eng-sync", emp: PEOPLE.diego.empId },
    { id: "ma-sync-priya", meeting: "mtg-eng-sync", emp: PEOPLE.priya.empId },
  ];
  for (const a of MEETING_ASSIGNMENTS) {
    await prisma.meetingAssignment.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, meetingId: a.meeting, employeeId: a.emp, assignedById: PEOPLE.marcus.userId },
    });
  }

  // 16. Recruiting (ATS, M1) — a live job req with its hiring team + interview rounds, and four
  //     candidates spread across the pipeline. Visibility is per-job TEAM (JobMember) via RLS: Raj
  //     (RECRUITER) + Marcus (HIRING_MANAGER) manage; Diego (INTERVIEWER) is read-only. The seed runs
  //     as the OWNER, which bypasses RLS and the ApplicationEvent append-only revoke, so it writes freely.
  const JOBS = [
    { id: "job-be", title: "Senior Backend Engineer", status: "OPEN", dept: DEPT.eng, openings: 2,
      location: "Remote (US)", employmentType: "FULL_TIME", eeoJobCategory: "PROFESSIONALS",
      description: "Own core services on our Postgres + Node stack. Strong SQL and API design." },
    // Left WITHOUT an EEO-1 category on purpose, so the filing export's "uncategorised" warning is
    // demoable — the gap it exists to surface is more interesting than a tidy dataset.
    { id: "job-pd", title: "Product Designer", status: "OPEN", dept: DEPT.eng, openings: 1,
      location: "San Francisco, CA", employmentType: "FULL_TIME",
      description: "Shape the product's look and flows end to end." },
  ];
  for (const j of JOBS) {
    // OPEN reqs are also POSTED PUBLICLY so the careers page has content. publishedAt is separate
    // from status on purpose: a req can be open internally without being advertised.
    const publishedAt = j.status === "OPEN" ? new Date("2026-06-01T09:00:00.000Z") : null;
    await prisma.job.upsert({
      where: { id: j.id },
      update: {
        title: j.title, status: j.status, openings: j.openings, location: j.location,
        description: j.description, publishedAt, eeoJobCategory: j.eeoJobCategory ?? null,
      },
      create: {
        id: j.id, title: j.title, description: j.description, location: j.location,
        employmentType: j.employmentType, status: j.status, openings: j.openings, publishedAt,
        eeoJobCategory: j.eeoJobCategory ?? null,
        orgId: ORG_ID, departmentId: j.dept, createdById: PEOPLE.raj.userId,
      },
    });
  }

  // Interview rounds for the backend req — the per-job INTERVIEW sub-steps, ordered by position.
  const ROUNDS = [
    { id: "ir-be-screen", job: "job-be", name: "Technical Screen", position: 0 },
    { id: "ir-be-design", job: "job-be", name: "System Design", position: 1 },
    { id: "ir-be-team", job: "job-be", name: "Team Interview", position: 2 },
  ];
  for (const r of ROUNDS) {
    await prisma.interviewRound.upsert({
      where: { id: r.id },
      update: { name: r.name, position: r.position },
      create: { id: r.id, jobId: r.job, name: r.name, position: r.position },
    });
  }

  // The backend req's hiring team (the join that powers ATS visibility).
  const JOB_MEMBERS = [
    { id: "jm-be-raj", job: "job-be", emp: PEOPLE.raj.empId, role: "RECRUITER" },
    { id: "jm-be-marcus", job: "job-be", emp: PEOPLE.marcus.empId, role: "HIRING_MANAGER" },
    { id: "jm-be-diego", job: "job-be", emp: PEOPLE.diego.empId, role: "INTERVIEWER" },
    // Raj also recruits the design req — so it has an owner, and (crucially for the candidate
    // database) a candidate can appear on TWO reqs while Marcus/Diego still see only the backend one.
    { id: "jm-pd-raj", job: "job-pd", emp: PEOPLE.raj.empId, role: "RECRUITER" },
    // A SECOND interviewer on the backend req who has deliberately submitted NO feedback — logging
    // in as Tom is how you see the anti-anchoring rule work (Diego's scorecard stays hidden until
    // Tom files his own). Priya is deliberately left OFF every hiring team: she is the suite's
    // "outsider" persona, and several tests rely on her seeing nothing at all.
    { id: "jm-be-tom", job: "job-be", emp: PEOPLE.tom.empId, role: "INTERVIEWER" },
  ];
  for (const m of JOB_MEMBERS) {
    await prisma.jobMember.upsert({
      where: { id: m.id },
      update: { role: m.role },
      create: { id: m.id, jobId: m.job, employeeId: m.emp, role: m.role, addedById: PEOPLE.raj.userId },
    });
  }

  // Campaigns (M2) — the attribution registry. Slugs are what a tracking link carries
  // (/careers/<job>?source=<slug>), so they're the demo's whole point: `careers-page` is what an
  // untracked visit falls back to, and the rest are real channels.
  //
  // One is ARCHIVED on purpose, so the demo shows the state that matters: an archived campaign keeps
  // the applications it already produced but its slug stops being accepted, which is the difference
  // between retiring a campaign and deleting one.
  const CAMPAIGNS = [
    { name: "Careers page", slug: "careers-page", channel: "CAREERS_PAGE" },
    { name: "Referral", slug: "referral", channel: "REFERRAL" },
    { name: "LinkedIn", slug: "linkedin", channel: "LINKEDIN" },
    { name: "LinkedIn — March grads", slug: "linkedin-march-grads", channel: "LINKEDIN" },
    { name: "Facebook — spring push", slug: "facebook-spring", channel: "FACEBOOK", archived: true },
  ];

  // ⚠️ UPSERT ON (orgId, slug), NOT ON A FIXED ID. The M2 migration BACKFILLS a campaign for every
  // distinct source it finds, with generated uuids — so on any database that already held
  // applications, `careers-page` exists with an id this file cannot predict. Upserting by a made-up
  // id would try to INSERT and hit the unique constraint on the slug. The slug IS the natural key
  // here, which is exactly why the constraint is on it.
  //
  // Applications below therefore reference campaigns BY SLUG and resolve the real id through this
  // map, so the seed works identically on a fresh database and on one that has been through the
  // backfill.
  const CAMPAIGN_ID_BY_SLUG = {};
  const CAMPAIGN_BY_SLUG = Object.fromEntries(CAMPAIGNS.map((c) => [c.slug, c]));
  for (const c of CAMPAIGNS) {
    const archivedAt = c.archived ? new Date("2026-08-01T00:00:00.000Z") : null;
    const row = await prisma.campaign.upsert({
      where: { orgId_slug: { orgId: ORG_ID, slug: c.slug } },
      // Re-assert name/channel/archivedAt so renaming or archiving in the browser is undone by a
      // reseed — the same repeatability trick the candidate fixtures use for erasure and lead marks.
      update: { name: c.name, channel: c.channel, archivedAt },
      create: {
        name: c.name,
        slug: c.slug,
        channel: c.channel,
        archivedAt,
        orgId: ORG_ID,
        createdById: SYSTEM_USER_ID,
      },
    });
    CAMPAIGN_ID_BY_SLUG[c.slug] = row.id;
  }

  // Candidates (people) — deduped by email within the org.
  const CANDIDATES = [
    { id: "cand-nora", firstName: "Nora", lastName: "Adeyemi", email: "nora.adeyemi@example.com", source: "LinkedIn" },
    // Owen is REJECTED on the design req but strong — the exact person the great-leads pool (M16)
    // exists for, and already the cross-job persona, so the demo needs no extra candidate.
    { id: "cand-owen", firstName: "Owen", lastName: "Zhang", email: "owen.zhang@example.com", source: "Referral",
      lead: "Excellent systems depth and communication — revisit for a staff backend role." },
    { id: "cand-mei", firstName: "Mei", lastName: "Tanaka", email: "mei.tanaka@example.com", source: "Careers page" },
    { id: "cand-luis", firstName: "Luis", lastName: "Romero", email: "luis.romero@example.com", source: "Referral" },
  ];
  for (const c of CANDIDATES) {
    await prisma.candidate.upsert({
      where: { id: c.id },
      // Re-asserting the anonymisation columns makes the M10 erasure demo REPEATABLE: erase someone
      // in the browser, reseed, and they're back. Without it the only way to undo a demo erasure is
      // a full `prisma migrate reset`, which throws away everything else too.
      update: {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        source: c.source,
        phone: c.phone ?? null,
        anonymisedAt: null,
        anonymisedById: null,
        anonymisationNote: null,
        // Same re-assertion for the M16 lead mark: mark or unmark someone in the browser, reseed,
        // and the fixture is back. Raj is the marker so the profile shows a real name rather than
        // the "marked by nobody" path.
        leadMarkedAt: c.lead ? new Date("2026-08-01T10:00:00.000Z") : null,
        leadMarkedById: c.lead ? PEOPLE.raj.empId : null,
        leadNote: c.lead ?? null,
      },
      create: {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        source: c.source,
        phone: c.phone ?? null,
        orgId: ORG_ID,
        leadMarkedAt: c.lead ? new Date("2026-08-01T10:00:00.000Z") : null,
        leadMarkedById: c.lead ? PEOPLE.raj.empId : null,
        leadNote: c.lead ?? null,
      },
    });
  }

  // Applications, spread across the pipeline AND across time (distinct appliedAt dates so the
  // candidate database's date-range filter has something real to bite on). Mei is mid-INTERVIEW at
  // "System Design". Owen appears TWICE — backend + design — which is what makes the candidate
  // profile's cross-job history (one person, many applications) visible in the demo.
  //
  // `source` is PER-APPLICATION since M1. Owen carries the point of the milestone: his FIRST touch
  // was the June design req via Referral, and he came back in July through LinkedIn. Attribution on
  // the candidate could only ever say "Referral" for both, so LinkedIn was reported as having
  // produced nobody. Now /reports credits each channel with the submission it actually caused, while
  // Candidate.source keeps saying Referral — because that is genuinely how we first met him.
  // M2: each application points at a CAMPAIGN; `source` is the snapshot of that campaign's name.
  // Owen's two applications sit in DIFFERENT LinkedIn campaigns from his first-touch Referral, which
  // makes both tables on /reports meaningful at once — "LinkedIn — March grads" and "LinkedIn" are
  // separate campaign rows that roll up into a single LINKEDIN channel row.
  const APPLICATIONS = [
    { id: "app-nora", cand: "cand-nora", job: "job-be", stage: "APPLIED", round: null, applied: "2026-08-05", campaign: "linkedin" },
    { id: "app-owen", cand: "cand-owen", job: "job-be", stage: "SCREEN", round: null, applied: "2026-07-28", campaign: "linkedin-march-grads" },
    { id: "app-mei", cand: "cand-mei", job: "job-be", stage: "INTERVIEW", round: "ir-be-design", applied: "2026-07-20", campaign: "careers-page" },
    { id: "app-luis", cand: "cand-luis", job: "job-be", stage: "OFFER", round: null, applied: "2026-07-10", campaign: "referral" },
    { id: "app-owen-pd", cand: "cand-owen", job: "job-pd", stage: "REJECTED", round: null,
      applied: "2026-06-15", rejectionCategory: "STRONGER_CANDIDATE", campaign: "referral" },
  ];
  for (const a of APPLICATIONS) {
    await prisma.application.upsert({
      where: { id: a.id },
      update: {
        stage: a.stage, currentRoundId: a.round,
        appliedAt: new Date(`${a.applied}T12:00:00.000Z`),
        rejectionCategory: a.rejectionCategory ?? null,
        campaignId: CAMPAIGN_ID_BY_SLUG[a.campaign] ?? null,
        source: CAMPAIGN_BY_SLUG[a.campaign]?.name ?? null,
      },
      create: {
        id: a.id, orgId: ORG_ID, jobId: a.job, candidateId: a.cand,
        stage: a.stage, currentRoundId: a.round,
        appliedAt: new Date(`${a.applied}T12:00:00.000Z`),
        rejectionCategory: a.rejectionCategory ?? null,
        campaignId: CAMPAIGN_ID_BY_SLUG[a.campaign] ?? null,
        source: CAMPAIGN_BY_SLUG[a.campaign]?.name ?? null,
      },
    });
  }

  // The append-only ApplicationEvent trail that produced each application's current stage. jobId is
  // denormalized (RLS one-liner); roundName is a snapshot. `update: {}` keeps it create-only on reseed.
  // `at` BACKDATES each event. ApplicationEvent.occurredAt is DB-defaulted precisely so the APP can
  // never backdate history — but the seed runs as the owner and sets it explicitly, so the demo has a
  // believable timeline. Without this every event lands at seed time and every reported duration is
  // ~0 days, which would make the M9 funnel and time-to-hire figures meaningless.
  const EVENTS = [
    { id: "ae-nora-1", app: "app-nora", from: null, to: "APPLIED", round: null, at: "2026-08-05" },
    { id: "ae-owen-1", app: "app-owen", from: null, to: "APPLIED", round: null, at: "2026-07-28" },
    { id: "ae-owen-2", app: "app-owen", from: "APPLIED", to: "SCREEN", round: null, at: "2026-08-03" },
    { id: "ae-mei-1", app: "app-mei", from: null, to: "APPLIED", round: null, at: "2026-07-20" },
    { id: "ae-mei-2", app: "app-mei", from: "APPLIED", to: "SCREEN", round: null, at: "2026-07-24" },
    { id: "ae-mei-3", app: "app-mei", from: "SCREEN", to: "INTERVIEW", round: "Technical Screen", at: "2026-07-30" },
    { id: "ae-mei-4", app: "app-mei", from: "INTERVIEW", to: "INTERVIEW", round: "System Design", note: "Advanced to System Design", at: "2026-08-04" },
    { id: "ae-luis-1", app: "app-luis", from: null, to: "APPLIED", round: null, at: "2026-07-10" },
    { id: "ae-luis-2", app: "app-luis", from: "APPLIED", to: "SCREEN", round: null, at: "2026-07-14" },
    { id: "ae-luis-3", app: "app-luis", from: "SCREEN", to: "INTERVIEW", round: "Technical Screen", at: "2026-07-21" },
    { id: "ae-luis-4", app: "app-luis", from: "INTERVIEW", to: "OFFER", round: null, at: "2026-08-01" },
    // Owen's earlier run at the design req: applied, then rejected. He's since re-applied to the
    // backend req (app-owen, now at SCREEN) — the talent-pool story the candidate database surfaces.
    { id: "ae-owen-pd-1", app: "app-owen-pd", job: "job-pd", from: null, to: "APPLIED", round: null, at: "2026-06-15" },
    { id: "ae-owen-pd-2", app: "app-owen-pd", job: "job-pd", from: "APPLIED", to: "REJECTED", round: null,
      note: "Strong portfolio, but we went with a more senior profile.", at: "2026-06-28" },
  ];
  for (const e of EVENTS) {
    await prisma.applicationEvent.upsert({
      where: { id: e.id },
      // Re-assert occurredAt so a reseed refreshes the demo TIMELINE (the reporting figures depend
      // on it). Only these fixed seed ids are touched; app-created events have random uuids and are
      // never rewritten — the append-only guarantee is about the APP, not the seeder.
      update: { occurredAt: e.at ? new Date(`${e.at}T10:00:00.000Z`) : undefined },
      create: {
        id: e.id, applicationId: e.app, jobId: e.job ?? "job-be",
        fromStage: e.from, toStage: e.to, roundName: e.round ?? null, note: e.note ?? null,
        occurredAt: e.at ? new Date(`${e.at}T10:00:00.000Z`) : undefined,
        actorId: PEOPLE.raj.userId,
      },
    });
  }

  // 17. Collaboration (M7) — what the backend req scores on, plus one SUBMITTED scorecard from Diego
  //     (INTERVIEWER) on Mei. Priya is on the same team with nothing submitted, so signing in as her
  //     demonstrates the anchoring guard: she cannot read Diego's feedback until she files her own.
  const COMPETENCIES = [
    { id: "jc-be-design", job: "job-be", name: "System design", position: 0 },
    { id: "jc-be-coding", job: "job-be", name: "Coding", position: 1 },
    { id: "jc-be-comms", job: "job-be", name: "Communication", position: 2 },
  ];
  for (const c of COMPETENCIES) {
    await prisma.jobCompetency.upsert({
      where: { id: c.id },
      update: { name: c.name, position: c.position },
      create: { id: c.id, jobId: c.job, name: c.name, position: c.position },
    });
  }

  await prisma.scorecard.upsert({
    where: { id: "sc-diego-mei" },
    update: {},
    create: {
      id: "sc-diego-mei",
      applicationId: "app-mei",
      jobId: "job-be",
      interviewRoundId: "ir-be-design",
      authorEmployeeId: PEOPLE.diego.empId,
      status: "SUBMITTED",
      recommendation: "YES",
      notes: "Strong on distributed systems; walked through trade-offs unprompted.",
      submittedAt: new Date("2026-07-22T16:00:00.000Z"),
    },
  });
  // competencyName is stored alongside the FK — a snapshot, so renaming a competency later never
  // rewrites what this debrief said.
  const DIEGO_RATINGS = [
    { id: "sr-1", comp: "jc-be-design", name: "System design", rating: 4, comment: "Clear on trade-offs." },
    { id: "sr-2", comp: "jc-be-coding", name: "Coding", rating: 3, comment: null },
    { id: "sr-3", comp: "jc-be-comms", name: "Communication", rating: 4, comment: "Explains well." },
  ];
  for (const r of DIEGO_RATINGS) {
    await prisma.scorecardRating.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id, scorecardId: "sc-diego-mei", competencyId: r.comp,
        competencyName: r.name, rating: r.rating, comment: r.comment,
      },
    });
  }

  // 18. Compliance (M10) — EEO self-identification + one open erasure request.
  //
  // ⚠️ EeoResponse cannot be written through the Prisma CLIENT: the table has RLS with no policies
  // and every privilege revoked from hris_app. The seed connects as the OWNER, so a raw INSERT works
  // here and only here — which is itself the demonstration. A raw insert rather than
  // app_submit_application because these applications already exist; the doorway writes a response
  // as part of creating one.
  const EEO = [
    { id: "eeo-nora", app: "app-nora", job: "job-be", g: "FEMALE", e: "BLACK_OR_AFRICAN_AMERICAN", v: "NOT_A_VETERAN", d: "NO" },
    { id: "eeo-owen", app: "app-owen", job: "job-be", g: "MALE", e: "WHITE", v: "PROTECTED_VETERAN", d: "NO" },
    { id: "eeo-mei", app: "app-mei", job: "job-be", g: "FEMALE", e: "ASIAN", v: "NOT_A_VETERAN", d: "DECLINED" },
    // Declining every question is a perfectly ordinary outcome, and the report has to show it.
    { id: "eeo-luis", app: "app-luis", job: "job-be", g: "DECLINED", e: "DECLINED", v: "DECLINED", d: "DECLINED" },
    { id: "eeo-owen-pd", app: "app-owen-pd", job: "job-pd", g: "MALE", e: "WHITE", v: "PROTECTED_VETERAN", d: "NO" },
  ];
  for (const r of EEO) {
    await prisma.$executeRaw`
      INSERT INTO "EeoResponse" (id, gender, ethnicity, "veteranStatus", "disabilityStatus",
                                 "submittedAt", "orgId", "applicationId", "jobId")
      VALUES (${r.id}, ${r.g}::"EeoGender", ${r.e}::"EeoEthnicity", ${r.v}::"EeoVeteranStatus",
              ${r.d}::"EeoDisabilityStatus", now(), ${ORG_ID}, ${r.app}, ${r.job})
      ON CONFLICT (id) DO NOTHING`;
  }

  // Nora has asked to be forgotten — so the compliance queue has something in it on first login, and
  // the erase flow is demoable without first having to file a request from the public page.
  await prisma.erasureRequest.upsert({
    where: { id: "er-nora" },
    // Reset to PENDING on reseed, for the same repeatability reason as the candidate upsert above:
    // actioning this request in a demo shouldn't cost a full database reset to get it back.
    update: { status: "PENDING", resolvedAt: null, resolvedById: null, decisionNote: null },
    create: {
      id: "er-nora",
      email: "nora.adeyemi@example.com",
      status: "PENDING",
      reason: "I've accepted another role — please remove my details.",
      requestedAt: new Date("2026-08-09T09:00:00.000Z"),
      orgId: ORG_ID,
      candidateId: "cand-nora",
    },
  });

  // Retention policy (M11). The migration inserts this too; asserting it here means the TEST
  // database — which is reseeded, not re-migrated, between tests — always starts from a known
  // window rather than whatever a previous test left behind.
  await prisma.appSetting.upsert({
    where: { key: "candidateRetentionDays" },
    update: { value: "365" },
    create: { key: "candidateRetentionDays", value: "365" },
  });

  // 19. Compensation (M14) — a band on the backend req, and Luis's live offer against it.
  //
  //     job-pd is deliberately left WITHOUT a band, so the "no approved band" state stays visible in
  //     the UI (same reasoning as its missing EEO-1 category: the gap a real system has to handle is
  //     more interesting to look at than a tidy dataset).
  //
  //     The band is POSTED PUBLICLY so the careers page demonstrates pay transparency. Note who can
  //     see what after this seed: Raj and Marcus read the band and the offer; Diego and Tom
  //     (INTERVIEWERs on the same req) read neither, and neither does Bianca — the DB refuses them
  //     the rows. A stranger on /careers sees the range and nothing else.
  await prisma.salaryBand.upsert({
    where: { jobId: "job-be" },
    update: {
      salaryMin: 120000,
      salaryMax: 160000,
      currency: "USD",
      payBasis: "PER_YEAR",
      postPublicly: true,
    },
    create: {
      id: "band-be",
      jobId: "job-be",
      salaryMin: 120000,
      salaryMax: 160000,
      currency: "USD",
      payBasis: "PER_YEAR",
      postPublicly: true,
    },
  });

  // Luis sits at OFFER, so his offer is EXTENDED — the state where the accept/decline/revise
  // controls are all live. Inside the band (150k against 120–160k, compa-ratio 1.07), so the
  // out-of-band justification stays unasked-for until someone demos it.
  //
  // The update branch RE-ASSERTS the status: a demo that extends, accepts or revises this offer is
  // undone by a reseed instead of needing a full `migrate reset`. Same trick as the anonymisation
  // columns on the candidate upserts.
  await prisma.offer.upsert({
    where: { id: "offer-luis-v1" },
    update: {
      status: "EXTENDED",
      salary: 150000,
      bandMinSnapshot: 120000,
      bandMaxSnapshot: 160000,
    },
    create: {
      id: "offer-luis-v1",
      applicationId: "app-luis",
      jobId: "job-be",
      createdById: PEOPLE.raj.userId,
      version: 1,
      status: "EXTENDED",
      salary: 150000,
      currency: "USD",
      payBasis: "PER_YEAR",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      notes: "Verbal yes pending the written offer.",
      bandMinSnapshot: 120000,
      bandMaxSnapshot: 160000,
    },
  });

  // OPT-IN demo volume. `SEED_DEMO_VOLUME=1 pnpm --filter @hris/database db:seed` adds a cohort of
  // extra applicants so the EEO aggregates clear the suppression threshold and the compliance report
  // shows real numbers instead of a wall of dashes.
  //
  // It is opt-in on purpose. The integration tests assert EXACT counts against the fixture above
  // (4 candidates, 5 applications, a specific funnel), and those numbers encode what M4 and M9
  // actually verified. Making the demo dataset a separate tier keeps the tests deterministic and the
  // demo interesting, instead of trading one for the other.
  if (process.env.SEED_DEMO_VOLUME === "1") {
    await seedEeoVolume();
  }

  const counts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    departments: await prisma.department.count(),
    employees: await prisma.employee.count(),
    historyRows: await prisma.employeeHistory.count(),
    leavePolicies: await prisma.leavePolicy.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    leaveLedgerEntries: await prisma.leaveLedgerEntry.count(),
    timesheets: await prisma.timesheet.count(),
    timeEntries: await prisma.timeEntry.count(),
    shifts: await prisma.shift.count(),
    clockEvents: await prisma.clockEvent.count(),
    projects: await prisma.project.count(),
    projectAssignments: await prisma.projectAssignment.count(),
    meetings: await prisma.meeting.count(),
    meetingAssignments: await prisma.meetingAssignment.count(),
    jobs: await prisma.job.count(),
    interviewRounds: await prisma.interviewRound.count(),
    jobMembers: await prisma.jobMember.count(),
    candidates: await prisma.candidate.count(),
    applications: await prisma.application.count(),
    applicationEvents: await prisma.applicationEvent.count(),
    competencies: await prisma.jobCompetency.count(),
    scorecards: await prisma.scorecard.count(),
    eeoResponses: Number(
      (await prisma.$queryRaw`SELECT count(*)::int AS n FROM "EeoResponse"`)[0].n,
    ),
    erasureRequests: await prisma.erasureRequest.count(),
    salaryBands: await prisma.salaryBand.count(),
    offers: await prisma.offer.count(),
    greatLeads: await prisma.candidate.count({ where: { leadMarkedAt: { not: null } } }),
  };
  console.log("Seed complete:", counts);
}

// ── Opt-in demo volume for the EEO report (SEED_DEMO_VOLUME=1) ───────────────────────────────────
//
// A compliance report whose every figure is withheld demonstrates the suppression rule but shows
// nothing else, and five applicants is nowhere near a threshold of five per CELL. This adds 21 more
// applicants, bringing the pool to 26 responses — deliberately shaped so the report shows BOTH
// behaviours at once:
//
//   • gender / ethnicity  → most groups clear the threshold and print real counts;
//   • veteran status      → PROTECTED_VETERAN lands at 3, so it is withheld — and because it would
//                           then be the ONLY withheld cell in that dimension, the complementary rule
//                           hides a second one, which is the part worth seeing work.
//
// Distributions are fixed, not random: a reseed must produce the same report, or the screenshot in
// the case study stops matching the app.
async function seedEeoVolume() {
  // Own lookup: this runs in a separate function from main(), so it cannot borrow main's map.
  const CAMPAIGN_ID_BY_SLUG = await campaignIdsBySlug();
  const fill = (value, n) => Array.from({ length: n }, () => value);

  const NAMES = [
    ["Amara", "Nwosu"], ["Ines", "Ferreira"], ["Tobias", "Kranz"], ["Yuki", "Sato"],
    ["Sofia", "Marchetti"], ["Dev", "Sharma"], ["Noah", "Lindqvist"], ["Camila", "Vega"],
    ["Ibrahim", "Toure"], ["Hannah", "O'Rourke"], ["Rafael", "Duarte"], ["Ling", "Zhao"],
    ["Marta", "Kowalska"], ["Elias", "Bergström"], ["Priyanka", "Rao"], ["Omar", "Haddad"],
    ["Freya", "Andersen"], ["Julien", "Moreau"], ["Nadia", "Petrova"], ["Kofi", "Mensah"],
    ["Lucia", "Ortega"],
  ];

  const GENDERS = [...fill("MALE", 8), ...fill("FEMALE", 7), ...fill("NON_BINARY", 2), ...fill("DECLINED", 4)];
  const ETHNICITIES = [
    ...fill("WHITE", 6), ...fill("ASIAN", 5), ...fill("HISPANIC_OR_LATINO", 5),
    ...fill("BLACK_OR_AFRICAN_AMERICAN", 3), ...fill("TWO_OR_MORE_RACES", 1), ...fill("DECLINED", 1),
  ];
  const VETERAN = [...fill("NOT_A_VETERAN", 16), ...fill("PROTECTED_VETERAN", 1), ...fill("DECLINED", 4)];
  const DISABILITY = [...fill("NO", 14), ...fill("YES", 4), ...fill("DECLINED", 3)];
  // M2: campaign ids, paired with the name each application snapshots.
  const SOURCES = [
    { slug: "careers-page", name: "Careers page" },
    { slug: "referral", name: "Referral" },
    { slug: "linkedin", name: "LinkedIn" },
    { slug: "careers-page", name: "Careers page" },
  ];

  for (const [i, [firstName, lastName]] of NAMES.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const candidateId = `cand-vol-${n}`;
    const applicationId = `app-vol-${n}`;
    // Two thirds to the backend req, a third to the design req, so a per-job filter is meaningful.
    const jobId = i % 3 === 2 ? "job-pd" : "job-be";
    const appliedAt = new Date(`2026-07-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`);

    await prisma.candidate.upsert({
      where: { id: candidateId },
      update: {},
      create: {
        id: candidateId,
        firstName,
        lastName,
        email: `${firstName.toLowerCase().replace(/[^a-z]/g, "")}.${lastName.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        source: SOURCES[i % SOURCES.length].name,
        orgId: ORG_ID,
      },
    });

    await prisma.application.upsert({
      where: { id: applicationId },
      update: {},
      // Each of these applies exactly once, so the application's source and the person's first touch
      // are the same value — which is also why the M1 backfill could copy it down for them safely.
      create: {
        id: applicationId, orgId: ORG_ID, jobId, candidateId, stage: "APPLIED", appliedAt,
        campaignId: CAMPAIGN_ID_BY_SLUG[SOURCES[i % SOURCES.length].slug],
        source: SOURCES[i % SOURCES.length].name,
      },
    });

    await prisma.applicationEvent.upsert({
      where: { id: `ae-vol-${n}` },
      update: { occurredAt: appliedAt },
      create: {
        id: `ae-vol-${n}`,
        applicationId,
        jobId,
        fromStage: null,
        toStage: "APPLIED",
        occurredAt: appliedAt,
        actorId: SYSTEM_USER_ID, // they came in through the careers page, like a real public apply
      },
    });

    await prisma.$executeRaw`
      INSERT INTO "EeoResponse" (id, gender, ethnicity, "veteranStatus", "disabilityStatus",
                                 "submittedAt", "orgId", "applicationId", "jobId")
      VALUES (${`eeo-vol-${n}`}, ${GENDERS[i]}::"EeoGender", ${ETHNICITIES[i]}::"EeoEthnicity",
              ${VETERAN[i]}::"EeoVeteranStatus", ${DISABILITY[i]}::"EeoDisabilityStatus",
              now(), ${ORG_ID}, ${applicationId}, ${jobId})
      ON CONFLICT (id) DO NOTHING`;
  }

  // Three long-cold applicants so the M11 retention sweep has something to catch in a demo. All
  // REJECTED (never an active stage) and dated well beyond the 365-day window, with BOTH createdAt
  // and their event backdated — the sweep takes the LATER of the two, so backdating only one would
  // leave them looking recent.
  //
  // These live in the opt-in tier deliberately: adding them to the base fixture would move the
  // exact counts that candidates.itest.js and reports.itest.js assert, and those numbers encode what
  // M4 and M9 actually verified. The sweep's own tests build their fixtures inline instead.
  //
  // Vera also carries a LEAD MARK (M16), which makes the milestone's central decision demoable in
  // one screen: she is old enough for the sweep to archive, and once it does she DISAPPEARS from
  // /candidates but REMAINS in /candidates/leads with an "Archived" pill. That pairing is the whole
  // argument for the pool being its own page rather than a filter.
  const COLD = [
    ["Vera", "Rubin", "2023-11-02", "Outstanding data work — worth a call if an analytics req opens."],
    ["Grace", "Hopper", "2024-01-18", null],
    ["Katherine", "Johnson", "2024-03-07", null],
  ];
  for (const [i, [firstName, lastName, on, lead]] of COLD.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const at = new Date(`${on}T12:00:00.000Z`);
    const candidateId = `cand-cold-${n}`;
    const applicationId = `app-cold-${n}`;

    await prisma.candidate.upsert({
      where: { id: candidateId },
      // Repeatable: reseed un-archives them and restores the lead mark.
      update: {
        archivedAt: null,
        archivedById: null,
        leadMarkedAt: lead ? at : null,
        leadMarkedById: lead ? PEOPLE.raj.empId : null,
        leadNote: lead ?? null,
      },
      create: {
        id: candidateId,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        source: "Careers page",
        orgId: ORG_ID,
        createdAt: at,
        leadMarkedAt: lead ? at : null,
        leadMarkedById: lead ? PEOPLE.raj.empId : null,
        leadNote: lead ?? null,
      },
    });
    await prisma.application.upsert({
      where: { id: applicationId },
      update: {},
      create: {
        id: applicationId, orgId: ORG_ID, jobId: "job-pd", candidateId,
        stage: "REJECTED", appliedAt: at, createdAt: at,
        campaignId: CAMPAIGN_ID_BY_SLUG["careers-page"], source: "Careers page",
      },
    });
    await prisma.applicationEvent.upsert({
      where: { id: `ae-cold-${n}` },
      update: { occurredAt: at },
      create: {
        id: `ae-cold-${n}`, applicationId, jobId: "job-pd",
        fromStage: null, toStage: "APPLIED", occurredAt: at, actorId: SYSTEM_USER_ID,
      },
    });
  }

  console.log(
    `Demo volume: +${NAMES.length} applicants with EEO responses, +${COLD.length} long-cold ` +
      `applicants for the retention sweep (SEED_DEMO_VOLUME=1).`,
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
