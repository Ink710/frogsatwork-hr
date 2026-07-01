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

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const { prisma, SYSTEM_USER_ID, Role, EmploymentStatus, EmploymentType } =
  await import("./index.js");

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
    email: "ana.okafor@peoplebase.test",
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
    email: "marcus.lee@peoplebase.test",
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
    email: "bianca.ross@peoplebase.test",
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
    email: "diego.santos@peoplebase.test",
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
    email: "priya.nair@peoplebase.test",
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
    email: "tom.becker@peoplebase.test",
    role: Role.EMPLOYEE,
    dept: "eng",
    manager: "diego", // level 4 of the tree
    hireDate: "2024-07-22",
    history: [
      { title: "Junior Software Engineer", type: EmploymentType.PART_TIME, salary: "64000.00", from: "2024-07-22", to: null },
    ],
  },
};

async function main() {
  // 1. Organization (multi-tenancy anchor).
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "PeopleBase Inc." },
  });

  // 2. System user — pinned id, attributes automated writes. Not an employee.
  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: {
      id: SYSTEM_USER_ID,
      email: "system@peoplebase.test",
      name: "System",
      role: Role.SYSTEM,
      isSystemUser: true,
      orgId: org.id,
    },
  });

  // 3. Departments (Engineering + People report up to Executive).
  await prisma.department.upsert({
    where: { id: DEPT.exec },
    update: {},
    create: { id: DEPT.exec, name: "Executive", orgId: org.id },
  });
  for (const [id, name] of [
    [DEPT.eng, "Engineering"],
    [DEPT.people, "People & Culture"],
  ]) {
    await prisma.department.upsert({
      where: { id },
      update: {},
      create: { id, name, orgId: org.id, parentDepartmentId: DEPT.exec },
    });
  }

  // 4. Users + Employees. Pass 1 creates every user and employee WITHOUT a manager
  //    link, so no row references one that doesn't exist yet.
  for (const p of Object.values(PEOPLE)) {
    await prisma.user.upsert({
      where: { id: p.userId },
      update: {},
      create: { id: p.userId, email: p.email, name: `${p.firstName} ${p.lastName}`, role: p.role, orgId: org.id },
    });

    await prisma.employee.upsert({
      where: { id: p.empId },
      update: {},
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

  // 6. Employee history (the temporal / SCD-2 rows). Snapshots capture the label as
  //    it was at the time; changedBy is the system user for seeded data.
  for (const p of Object.values(PEOPLE)) {
    const deptName = { exec: "Executive", eng: "Engineering", people: "People & Culture" }[p.dept];
    const managerName = p.manager ? `${PEOPLE[p.manager].firstName} ${PEOPLE[p.manager].lastName}` : null;

    let version = 0;
    for (const h of p.history) {
      version += 1;
      await prisma.employeeHistory.upsert({
        where: { employeeId_version: { employeeId: p.empId, version } },
        update: {},
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
