import { cache } from "react";
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

// Single employee for the profile page, with the FULL effective-dated timeline.
//
// Wrapped in React's `cache()`: within one request, calling this twice (the page
// body AND generateMetadata both need it) runs the DB query only once. The cache is
// per-request, so it never leaks data between users.
//
// Same compensation guard as the list: `salary` and `currency` are never selected.
// The timeline shows what changed and when — not how much someone earns — until RBAC.
export const getEmployeeProfile = cache(async (id) => {
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      employmentStatus: true,
      hireDate: true,
      terminationDate: true,
      department: { select: { name: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      reports: {
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
      emergencyContacts: {
        select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
        orderBy: { isPrimary: "desc" },
      },
      // Every version, newest first. The open row (effectiveTo = null) is "now".
      history: {
        select: {
          id: true,
          version: true,
          jobTitle: true,
          employmentType: true,
          departmentSnapshot: true,
          managerSnapshot: true,
          changeReason: true,
          changedFields: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
        orderBy: { version: "desc" },
      },
    },
  });

  return employee; // null when the id doesn't exist — caller turns that into a 404.
});
