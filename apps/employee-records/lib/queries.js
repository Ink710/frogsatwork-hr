import { prisma } from "@hris/database";

// Data access for the employee list. Runs on the server only (imported by a Server
// Component), so the Prisma client — and the DB credentials — never reach the browser.
//
// Note the deliberate omission: we do NOT select `salary`. Compensation is sensitive
// and must be guarded in the API/query layer, not just hidden in the UI. Until the
// RBAC milestone decides who may see it, we simply never fetch it here.
export async function getEmployees() {
  const rows = await prisma.employee.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      employmentStatus: true,
      department: { select: { name: true } },
      manager: { select: { firstName: true, lastName: true } },
      // The CURRENT version of the versioned fields is the one open history row
      // (effectiveTo = null). That's where the live job title lives.
      history: {
        where: { effectiveTo: null },
        select: { jobTitle: true, employmentType: true },
        take: 1,
      },
    },
  });

  // Flatten into a plain shape the table can render without knowing about Prisma.
  return rows.map((e) => ({
    id: e.id,
    employeeNumber: e.employeeNumber,
    name: `${e.firstName} ${e.lastName}`,
    department: e.department?.name ?? "—",
    manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : "—",
    title: e.history[0]?.jobTitle ?? "—",
    employmentType: e.history[0]?.employmentType ?? "—",
    status: e.employmentStatus,
  }));
}
