import { cache } from "react";
import {
  getViewer,
  withViewer,
  resolveCompAccess,
  isPayroll,
  getRecordScope,
  canEditEmployee,
  canEditCompensation,
  canTerminate,
  canManageSettings,
  getSubtreeIds,
  canViewBudget,
  canViewBudgetOverview,
  canManageDepartments,
} from "@hris/auth";
import type { Viewer } from "@hris/auth";
import { Prisma } from "@hris/database";
import type { EmploymentStatus, EmploymentType } from "@hris/database";
import { isWithinCorrectionWindow, CORRECTION_WINDOW_DAYS, EMPLOYMENT_TYPES } from "@hris/types";
import { buildTree } from "./tree.js";
// Extensionless: format is now .ts. An explicit "./format.js" resolves to the .ts file in tsc
// and esbuild but NOT in Next's bundler — extensionless resolves everywhere. (tree is still .js.)
import { REDACTED } from "./format";

export const EMPLOYEE_PAGE_SIZE = 5;

const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"];

// Filters for the employee list. Every field is optional and arrives unvalidated from the URL
// query string (hence plain strings), so the body validates + narrows before using them.
type EmployeeListFilters = {
  q?: string;
  status?: string;
  departmentId?: string;
  employmentType?: string;
  page?: number;
};

// Data access for the employee list. Runs inside withViewer(), so RLS scopes the rows to the
// signed-in user first — the search/filter `where` and the count then narrow WITHIN that visible
// set (a manager searching only ever matches their own subtree). Compensation is never selected.
// Offset-paginated: returns the page plus the total so the UI can show "A–B of N" and page links.
export async function getEmployees({ q, status, departmentId, employmentType, page = 1 }: EmployeeListFilters = {}) {
  const viewer = await getViewer();
  if (!viewer) return { rows: [], total: 0, page: 1, pageSize: EMPLOYEE_PAGE_SIZE, pageCount: 1 };

  // Build the filter. Every clause is optional and ANDed under RLS. Typing the array as
  // Prisma.EmployeeWhereInput[] makes every pushed clause checked against the real schema
  // (a typo'd field name or bad enum value is now a compile error, not a silent 0-row query).
  const and: Prisma.EmployeeWhereInput[] = [];
  // Free-text search: each whitespace token must appear in at least one field, so "Diego Santos"
  // matches (Diego → firstName, Santos → lastName) without a dedicated full-name column.
  const tokens = (q ?? "").trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    and.push({
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
        { employeeNumber: { contains: t, mode: "insensitive" } },
        { email: { contains: t, mode: "insensitive" } },
      ],
    });
  }
  // Runtime-validate the URL string, then cast to the enum for Prisma. (EMPLOYMENT_STATUSES is a
  // plain string[], so .includes accepts a string directly.)
  if (status && EMPLOYMENT_STATUSES.includes(status)) {
    and.push({ employmentStatus: status as EmploymentStatus });
  }
  if (departmentId) and.push({ departmentId });
  // Employment type lives on the CURRENT (open) history version, not on Employee. EMPLOYMENT_TYPES
  // is a readonly tuple of literals (`as const` in @hris/types), so .includes() won't take an
  // arbitrary string — widen it to readonly string[] for the membership test, then cast.
  if (employmentType && (EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) {
    and.push({ history: { some: { effectiveTo: null, employmentType: employmentType as EmploymentType } } });
  }
  const where = and.length ? { AND: and } : {};

  const pageSize = EMPLOYEE_PAGE_SIZE;

  return withViewer(viewer, async (tx) => {
    // Count and page in the same RLS transaction so the total matches what's paged.
    const total = await tx.employee.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page | 0 || 1), pageCount); // clamp; ?page=99 → last page

    const rows = await tx.employee.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        department: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
        history: {
          where: { effectiveTo: null },
          select: { jobTitle: true, employmentType: true },
          take: 1,
        },
      },
    });

    return {
      rows: rows.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.firstName} ${e.lastName}`,
        department: e.department?.name ?? "—",
        manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : "—",
        title: e.history[0]?.jobTitle ?? "—",
        employmentType: e.history[0]?.employmentType ?? "—",
        status: e.employmentStatus,
      })),
      total,
      page: safePage,
      pageSize,
      pageCount,
    };
  });
}

// Department options for the list filter dropdown (id + name). Department has no RLS, so any
// authenticated viewer may list them; not sensitive.
export async function getDepartmentOptions() {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, (tx) =>
    tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  );
}

// Leave/suspension visibility helper, shared by the Overview + History queries. RLS already
// scoped the ROWS to this viewer; here we filter FIELDS/records by whether the viewer IS the
// subject (like the comp guard, app-side):
//   - non-subject (HR / managing chain): full detail — current banner + all history.
//   - subject viewing self: sees the current status as a NOTICE (status + dates), but a
//     SUSPENSION's reason/who is hidden; and past suspensions don't appear in their history
//     (past leaves do).
function scopeStatusChanges<T extends { type: string; endDate: Date | null }>(
  statusChanges: T[],
  isSubject: boolean,
) {
  const notice = (rec: T) => ({ ...rec, reason: null, createdBy: null }); // strip sensitive fields
  const openRec = statusChanges.find((r) => r.endDate === null) ?? null;
  const currentStatusChange = openRec
    ? isSubject && openRec.type === "SUSPENSION"
      ? notice(openRec)
      : openRec
    : null;
  let statusHistory = statusChanges.filter((r) => r.endDate !== null);
  if (isSubject) statusHistory = statusHistory.filter((r) => r.type === "LEAVE");
  return { currentStatusChange, statusHistory };
}

// Lean identity + contact facts for the profile LAYOUT sidebar. Deliberately NO compensation
// and NO audit write: the layout re-runs on every tab, so this must never touch the audit log
// (that would log a "view" per tab switch). cache() dedupes it with the layout's metadata.
export const getEmployeeSummary = cache(async (id: string) => {
  const viewer = await getViewer();
  if (!viewer) return null;

  return withViewer(viewer, async (tx) => {
    const e = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        location: true,
        employmentStatus: true,
        hireDate: true,
        terminationDate: true, // tenure end for terminated staff
        department: { select: { name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        history: {
          where: { effectiveTo: null },
          select: { jobTitle: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!e) return null;

    return {
      id: e.id,
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      name: `${e.firstName} ${e.lastName}`,
      title: e.history[0]?.jobTitle ?? null,
      employmentStatus: e.employmentStatus,
      hireDate: e.hireDate,
      terminationDate: e.terminationDate,
      location: e.location,
      email: e.email,
      phone: e.phone,
      department: e.department?.name ?? "—",
      manager: e.manager
        ? { id: e.manager.id, name: `${e.manager.firstName} ${e.manager.lastName}` }
        : null,
    };
  });
});

// The Overview tab: the current version's employment facts, the comp-gated compensation block,
// emergency contacts, status banners, activation state, and direct reports. This is the profile
// "view", so it (and only the default tab) writes the payroll VIEW audit entry. cache() dedupes
// the page body with any metadata so we log at most once per request.
export const getEmployeeOverview = cache(async (id: string) => {
  const viewer = await getViewer();
  if (!viewer) return null;

  return withViewer(viewer, async (tx) => {
    // Everything EXCEPT compensation. If the employee isn't visible, RLS returns null → 404.
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        employmentStatus: true,
        terminationDate: true,
        terminationReason: true,
        eligibleForRehire: true,
        rehireDate: true,
        departmentId: true, // for the comp-access check
        userId: true,
        // Ungated current-state facts shown in the Employment card.
        workSchedule: true,
        timeZone: true,
        user: { select: { emailVerifiedAt: true, invitedAt: true } },
        reports: {
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        },
        emergencyContacts: {
          select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
          orderBy: { isPrimary: "desc" },
        },
        // Current (open) version — the ungated employment facts. flsa + payFrequency show in the
        // Employment card; the row id lets us fetch its comp fields below only if allowed.
        history: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { version: "desc" },
          select: {
            id: true,
            jobTitle: true,
            employmentType: true,
            flsaClassification: true,
            payFrequency: true,
          },
        },
        statusChanges: {
          select: {
            id: true,
            type: true,
            reason: true,
            startDate: true,
            expectedEnd: true,
            endDate: true,
            createdBy: { select: { name: true } },
          },
          orderBy: { startDate: "desc" },
        },
      },
    });
    if (!employee) return null;

    const canViewComp = await resolveCompAccess(
      viewer,
      { id: employee.id, departmentId: employee.departmentId },
      tx,
    );

    // Comp-sensitive block: current-version salary/basis + the current-state review/equity
    // fields. Fetched ONLY when allowed — "don't fetch what you can't show" (same rule as salary).
    // `let comp = null` would infer the type `null`; annotate so the object assignment below fits.
    let comp: {
      salary: string | null;
      currency: string | null;
      payBasis: string | null;
      lastReviewDate: Date | null;
      nextReviewDate: Date | null;
      equityNote: string | null;
    } | null = null;
    if (canViewComp) {
      const currentVersionId = employee.history[0]?.id ?? null;
      // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
      const row = currentVersionId
        ? await tx.employeeHistory.findUnique({
            where: { id: currentVersionId },
            select: { salary: true, currency: true, payBasis: true },
          })
        : null;
      const sensitive = await tx.employee.findUnique({
        where: { id },
        select: { lastReviewDate: true, nextReviewDate: true, equityNote: true },
      });
      comp = {
        salary: row?.salary?.toString() ?? null,
        currency: row?.currency ?? null,
        payBasis: row?.payBasis ?? null,
        lastReviewDate: sensitive?.lastReviewDate ?? null,
        nextReviewDate: sensitive?.nextReviewDate ?? null,
        equityNote: sensitive?.equityNote ?? null,
      };

      // Payroll's broad comp access is logged. occurredAt is DB-defaulted; hris_app is INSERT-only.
      if (isPayroll(viewer.role)) {
        await tx.employeeAuditLog.create({
          data: { employeeId: id, eventType: "VIEW", actorType: "USER", actorId: viewer.userId },
        });
      }
    }

    const { statusChanges, history, ...rest } = employee;
    const isSubject = viewer.employeeId === employee.id;
    const scoped = scopeStatusChanges(statusChanges, isSubject);

    return {
      ...rest,
      current: history[0] ?? null,
      canViewComp,
      comp,
      ...scoped,
    };
  });
});

// The History tab: the full effective-dated timeline. Salary/pay-basis are comp-gated; FLSA and
// pay frequency ride along ungated so the timeline can show role/classification changes. Logs a
// payroll VIEW too, since salary is exposed here just as on Overview.
export async function getEmployeeHistory(id: string) {
  const viewer = await getViewer();
  if (!viewer) return null;

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: { id: true, departmentId: true },
    });
    if (!employee) return null;

    const history = await tx.employeeHistory.findMany({
      where: { employeeId: id },
      orderBy: { version: "desc" },
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
        flsaClassification: true,
        payFrequency: true,
      },
    });

    const canViewComp = await resolveCompAccess(
      viewer,
      { id: employee.id, departmentId: employee.departmentId },
      tx,
    );

    let rows = history;
    if (canViewComp) {
      const comp = await tx.employeeHistory.findMany({
        where: { employeeId: id },
        select: { id: true, salary: true, currency: true, payBasis: true },
      });
      const byId = new Map(comp.map((c) => [c.id, c]));
      rows = history.map((h) => ({
        ...h,
        salary: byId.get(h.id)?.salary?.toString() ?? null,
        currency: byId.get(h.id)?.currency ?? null,
        payBasis: byId.get(h.id)?.payBasis ?? null,
      }));

      if (isPayroll(viewer.role)) {
        await tx.employeeAuditLog.create({
          data: { employeeId: id, eventType: "VIEW", actorType: "USER", actorId: viewer.userId },
        });
      }
    }

    return { history: rows, canViewComp };
  });
}

// The Access & RBAC tab: this employee's system role + a read-only summary of what that role
// grants, plus their account-activation state. Gated to HR or the subject themselves (a manager
// viewing a report gets null → the route 404s and the tab is hidden). Capabilities come straight
// from the pure role logic in @hris/auth, so this view can never drift from real enforcement.
export async function getEmployeeAccess(id: string) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const isSubject = viewer.employeeId === id;
  if (!canEditEmployee(viewer) && !isSubject) return null;

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: {
          select: { role: true, email: true, emailVerifiedAt: true, invitedAt: true },
        },
      },
    });
    if (!employee) return null;

    // A SYNTHETIC viewer standing in for the TARGET employee's role, used only to preview what
    // that role grants. The predicates below read only `.role`, so the other Viewer fields are
    // placeholders (never inspected here). Typed as Viewer so the capability calls type-check.
    const roleViewer: Viewer = {
      userId: "",
      employeeId: null,
      role: employee.user.role,
      orgId: viewer.orgId,
    };
    return {
      employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}` },
      role: employee.user.role,
      email: employee.user.email,
      activation: {
        emailVerifiedAt: employee.user.emailVerifiedAt,
        invitedAt: employee.user.invitedAt,
      },
      capabilities: {
        recordScope: getRecordScope(roleViewer),
        editRecords: canEditEmployee(roleViewer),
        editCompensation: canEditCompensation(roleViewer),
        terminate: canTerminate(roleViewer),
        manageDepartments: canManageDepartments(roleViewer),
        manageSettings: canManageSettings(roleViewer),
      },
    };
  });
}

// Prefill data for the "record a change" form. Returns null if the viewer may not edit
// (also gates the route). Manager candidates exclude the employee's own subtree so a
// reassignment can't create a reporting cycle.
export async function getEmployeeForEdit(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;
  const canEditComp = canEditCompensation(viewer);

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        managerId: true,
        employmentStatus: true,
      },
    });
    if (!employee) return null;

    const current = await tx.employeeHistory.findFirst({
      where: { employeeId: id, effectiveTo: null },
      orderBy: { version: "desc" },
      select: {
        jobTitle: true,
        employmentType: true,
        flsaClassification: true,
        payFrequency: true,
        currency: true,
        effectiveFrom: true,
        ...(canEditComp ? { salary: true, payBasis: true } : {}),
      },
    });

    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const subtree = await getSubtreeIds(id, tx);
    const all = await tx.employee.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const managerOptions = all
      .filter((e) => !subtree.has(e.id)) // excludes self + descendants → no cycles
      .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }));

    return {
      employee,
      // `salary` is only present when it was conditionally selected (comp editors); the
      // `"salary" in current` guard narrows the union so TS knows the field exists here.
      current: current
        ? { ...current, salary: "salary" in current ? (current.salary?.toString() ?? null) : null }
        : null,
      departments,
      managerOptions,
      canEditComp,
    };
  });
}

// Prefill + window status for the "Correct data" page.
export async function getEmployeeForCorrection(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;
  const canEditComp = canEditCompensation(viewer);

  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        departmentId: true,
        managerId: true,
        // Current-state descriptive fields (prefill the details-correction form).
        phone: true,
        location: true,
        workSchedule: true,
        timeZone: true,
        ...(canEditComp
          ? { lastReviewDate: true, nextReviewDate: true, equityNote: true }
          : {}),
      },
    });
    if (!employee) return null;

    const current = await tx.employeeHistory.findFirst({
      where: { employeeId: id, effectiveTo: null },
      orderBy: { version: "desc" },
      select: {
        jobTitle: true,
        employmentType: true,
        flsaClassification: true,
        payFrequency: true,
        currency: true,
        createdAt: true,
        ...(canEditComp ? { salary: true, payBasis: true } : {}),
      },
    });

    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const subtree = await getSubtreeIds(id, tx);
    const all = await tx.employee.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    const managerOptions = all
      .filter((e) => !subtree.has(e.id))
      .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }));

    return {
      employee,
      // `salary` is only present when it was conditionally selected (comp editors); the
      // `"salary" in current` guard narrows the union so TS knows the field exists here.
      current: current
        ? { ...current, salary: "salary" in current ? (current.salary?.toString() ?? null) : null }
        : null,
      // The window is about ENTRY recency (createdAt), not the effective date.
      withinWindow: current ? isWithinCorrectionWindow(current.createdAt) : false,
      windowDays: CORRECTION_WINDOW_DAYS,
      departments,
      managerOptions,
      canEditComp,
    };
  });
}

// Light query for the terminate/rehire pages. Gated to lifecycle managers (HR_ADMIN).
export async function getEmployeeForLifecycle(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return null;
  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        eligibleForRehire: true,
      },
    });
    return employee;
  });
}

// Prefill for the "place on leave / suspend" page. Gated to HR_ADMIN. The action re-checks
// that the employee is ACTIVE; we return the status so the form can refuse up front too.
export async function getEmployeeForStatusChange(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return null;
  return withViewer(viewer, (tx) =>
    tx.employee.findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, employmentStatus: true },
    }),
  );
}

// Prefill for the "return to active" page. Gated to HR_ADMIN. Includes the open status
// record (the one we're about to close) so the form can show what's being ended.
export async function getEmployeeForReinstate(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canTerminate(viewer)) return null;
  return withViewer(viewer, async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        statusChanges: {
          where: { endDate: null },
          select: { id: true, type: true, startDate: true, expectedEnd: true },
          orderBy: { startDate: "desc" },
          take: 1,
        },
      },
    });
    if (!employee) return null;
    return { ...employee, current: employee.statusChanges[0] ?? null };
  });
}

// The COMPLETE company org chart (a directory), shown to every signed-in user. Structure comes
// from the app_org_chart() SECURITY DEFINER function, which bypasses the Employee RLS but returns
// ONLY non-sensitive columns (name/title/department/manager) — so no personal data leaks even to
// an employee who can't open anyone else's profile. Each node is marked `linkable` only if the
// viewer may actually open that profile (their RLS-visible set), so the chart has no dead links.
export async function getOrgChart() {
  const viewer = await getViewer();
  if (!viewer) return [];

  return withViewer(viewer, async (tx) => {
    // app_org_chart returns ONLY these non-sensitive structural columns (SECURITY DEFINER,
    // bypasses Employee RLS) — declare the row shape so the map below is typed.
    type OrgRow = {
      id: string;
      managerId: string | null;
      firstName: string;
      lastName: string;
      jobTitle: string | null;
      department: string | null;
    };
    const rows = await tx.$queryRaw<OrgRow[]>`SELECT * FROM app_org_chart(${viewer.orgId})`;
    // The subset of those the viewer may open (RLS-scoped) → which nodes become links.
    const visible = await tx.employee.findMany({ select: { id: true } });
    const visibleSet = new Set(visible.map((v) => v.id));

    return buildTree(
      rows.map((r) => ({
        id: r.id,
        managerId: r.managerId,
        name: `${r.firstName} ${r.lastName}`,
        initials: `${r.firstName?.[0] ?? ""}${r.lastName?.[0] ?? ""}`.toUpperCase(),
        title: r.jobTitle ?? "—",
        department: r.department ?? null,
        linkable: visibleSet.has(r.id),
      })),
    );
  });
}

// Where a user lands right after signing in (the home page dispatches here). Role-based:
//   EMPLOYEE → their own profile   MANAGER → their department   HR/Payroll → the employee list.
export async function getLandingPath() {
  const viewer = await getViewer();
  if (!viewer) return "/login";

  if (viewer.role === "EMPLOYEE") {
    return viewer.employeeId ? `/employees/${viewer.employeeId}` : "/employees";
  }
  if (viewer.role === "MANAGER" && viewer.employeeId) {
    // Capture into a const: TS narrows viewer.employeeId to string here, but that narrowing is
    // lost inside the withViewer callback (a closure could run later), so the local keeps it.
    const employeeId = viewer.employeeId;
    const me = await withViewer(viewer, (tx) =>
      tx.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } }),
    );
    if (me?.departmentId) return `/departments/${me.departmentId}`;
  }
  return "/employees";
}

// Company-wide department budgets for the dashboard pie — "upper management" only
// (HR_ADMIN + PAYROLL_ADMIN via canViewBudgetOverview). Returns null when the viewer isn't
// entitled (the dashboard then omits the chart entirely). RLS on DepartmentBudget is a second
// wall: even inside withViewer, only rows the viewer may see come back — for these two roles,
// that's all of them, so the pie is complete.
export async function getDepartmentBudgets() {
  const viewer = await getViewer();
  if (!viewer || !canViewBudgetOverview(viewer)) return null;

  return withViewer(viewer, async (tx) => {
    const rows = await tx.departmentBudget.findMany({
      select: { budget: true, department: { select: { name: true } } },
    });
    return rows
      .map((r) => ({ name: r.department?.name ?? "—", budget: r.budget.toString() }))
      .sort((a, b) => Number(b.budget) - Number(a.budget));
  });
}

// Aggregations for the HR dashboard. Every count is computed from the viewer's RLS-scoped
// employees, so the dashboard auto-scopes: HR sees the whole org, a manager sees their
// team's numbers. Compensation aggregates are intentionally omitted (sensitive).
export async function getDashboardStats() {
  const viewer = await getViewer();
  if (!viewer) return null;

  const rows = await withViewer(viewer, (tx) =>
    tx.employee.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        hireDate: true,
        terminationDate: true,
        managerId: true,
        department: { select: { name: true } },
        history: { where: { effectiveTo: null }, select: { employmentType: true }, take: 1 },
      },
    }),
  );

  const thisYear = new Date().getFullYear();
  const nameById = new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

  // Keyed tallies. Without the Record<string, number> annotation, indexing `{}` by a dynamic
  // string key ("Element implicitly has an any type") is a strict-mode error.
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byDept: Record<string, number> = {};
  const reports: Record<string, number> = {}; // managerId -> active direct-report count
  let newHires = 0;
  let terminations = 0;

  for (const r of rows) {
    byStatus[r.employmentStatus] = (byStatus[r.employmentStatus] ?? 0) + 1;
    if (r.hireDate && new Date(r.hireDate).getFullYear() === thisYear) newHires += 1;
    if (r.terminationDate && new Date(r.terminationDate).getFullYear() === thisYear) terminations += 1;

    if (r.employmentStatus !== "TERMINATED") {
      const t = r.history[0]?.employmentType ?? "UNKNOWN";
      byType[t] = (byType[t] ?? 0) + 1;
      const d = r.department?.name ?? "—";
      byDept[d] = (byDept[d] ?? 0) + 1;
      if (r.managerId && nameById.has(r.managerId)) {
        reports[r.managerId] = (reports[r.managerId] ?? 0) + 1;
      }
    }
  }

  const toSortedPairs = (obj: Record<string, number>) =>
    Object.entries(obj)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

  const spanOfControl = Object.entries(reports)
    .map(([id, count]) => ({ label: nameById.get(id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const activeHeadcount = rows.filter((r) => r.employmentStatus !== "TERMINATED").length;

  return {
    activeHeadcount,
    departmentCount: Object.keys(byDept).length,
    newHires,
    terminations,
    byDepartment: toSortedPairs(byDept),
    byType: toSortedPairs(byType),
    byStatus: toSortedPairs(byStatus),
    spanOfControl,
  };
}

// Department directory. Gated to non-EMPLOYEE roles. Departments have no RLS so all are
// listed; the per-department headcount is RLS-scoped (what the viewer can see); budget is
// shown only where canViewBudget allows.
export async function getDepartments() {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "EMPLOYEE") return null;

  return withViewer(viewer, async (tx) => {
    const me = viewer.employeeId
      ? await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } })
      : null;
    const viewerDeptId = me?.departmentId ?? null;

    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true, headUserId: true, head: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

    // Budgets come from the RLS'd table: this returns ONLY the rows this viewer may see —
    // the DB is the enforcer. canViewBudget below is just the UI hint (Restricted vs "—").
    const budgetRows = await tx.departmentBudget.findMany({ select: { departmentId: true, budget: true } });
    const budgetByDept = new Map(budgetRows.map((b) => [b.departmentId, b.budget.toString()]));

    const result = [];
    for (const d of departments) {
      const employeeCount = await tx.employee.count({
        where: { departmentId: d.id, employmentStatus: { not: "TERMINATED" } },
      });
      const showBudget = canViewBudget(viewer, { id: d.id, headUserId: d.headUserId }, viewerDeptId);
      result.push({
        id: d.id,
        name: d.name,
        headName: d.head?.name ?? null,
        employeeCount,
        budget: budgetByDept.get(d.id) ?? null, // RLS-authoritative
        budgetHidden: !showBudget,
      });
    }
    return result;
  });
}

// One department: gated budget, RLS-scoped employees + stats, head profile link, and a
// mini org tree restricted to this department's visible members.
export async function getDepartmentDetail(id: string) {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "EMPLOYEE") return null;

  return withViewer(viewer, async (tx) => {
    const department = await tx.department.findUnique({
      where: { id },
      select: { id: true, name: true, headUserId: true, head: { select: { name: true } } },
    });
    if (!department) return null;

    const me = viewer.employeeId
      ? await tx.employee.findUnique({ where: { id: viewer.employeeId }, select: { departmentId: true } })
      : null;
    const showBudget = canViewBudget(viewer, { id: department.id, headUserId: department.headUserId }, me?.departmentId ?? null);
    // RLS returns the budget row only if allowed — the DB wall; showBudget is the UI hint.
    const budgetRow = await tx.departmentBudget.findUnique({ where: { departmentId: id }, select: { budget: true } });

    const emps = await tx.employee.findMany({
      where: { departmentId: id, employmentStatus: { not: "TERMINATED" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        managerId: true,
        history: { where: { effectiveTo: null }, select: { jobTitle: true, employmentType: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    // Head's linkable employee (only if visible under RLS). Guarding on headUserId too narrows
    // it from `string | null` to string for the Prisma `where`, and typing `head` up front lets
    // the object assignment fit (a bare `let head = null` would infer the type `null`).
    let head: { name: string; employeeId: string | null } | null = null;
    if (department.head && department.headUserId) {
      const headEmp = await tx.employee.findFirst({ where: { userId: department.headUserId }, select: { id: true } });
      head = { name: department.head.name, employeeId: headEmp?.id ?? null };
    }

    // Composition by employment type.
    const byType: Record<string, number> = {};
    for (const e of emps) {
      const t = e.history[0]?.employmentType ?? "UNKNOWN";
      byType[t] = (byType[t] ?? 0) + 1;
    }
    const byTypePairs = Object.entries(byType)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Mini org tree, restricted to this department's RLS-visible set. Every node here IS visible
    // to the viewer (RLS already scoped `emps`), so all are linkable.
    const tree = buildTree(
      emps.map((e) => ({
        id: e.id,
        managerId: e.managerId,
        name: `${e.firstName} ${e.lastName}`,
        initials: `${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase(),
        title: e.history[0]?.jobTitle ?? "—",
        department: null,
        linkable: true,
      })),
    );

    return {
      department: {
        id: department.id,
        name: department.name,
        budget: budgetRow?.budget?.toString() ?? null, // RLS-authoritative
        budgetHidden: !showBudget,
      },
      head,
      headcount: emps.length,
      byType: byTypePairs,
      employees: emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, title: e.history[0]?.jobTitle ?? "—" })),
      tree,
    };
  });
}

// --- Department management (write-side form data) -----------------------------------------

// Given all departments in the org, return the set of ids at-or-below `rootId` (the root plus
// every descendant). Used to keep a department from being parented under itself or its own
// child — there's no app_subtree() equivalent for the department tree, and N is tiny, so we
// walk it in JS. Exported so the update action can re-check server-side (never trust the client).
export function departmentDescendantIds(
  rootId: string,
  allDepartments: Array<{ id: string; parentDepartmentId: string | null }>,
) {
  const childrenOf = new Map<string | null, string[]>();
  for (const d of allDepartments) {
    // Fetch-or-create the sibling list instead of has()+get(): TS can't correlate the two, so
    // a bare childrenOf.get(...).push(...) would be "possibly undefined".
    const siblings = childrenOf.get(d.parentDepartmentId);
    if (siblings) siblings.push(d.id);
    else childrenOf.set(d.parentDepartmentId, [d.id]);
  }
  const result = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const currentId = stack.pop();
    if (currentId === undefined) break; // unreachable given the while guard, but narrows the type
    for (const child of childrenOf.get(currentId) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result; // includes rootId
}

// Candidate lists for the "new department" form. Gated to HR_ADMIN.
export async function getNewDepartmentFormData() {
  const viewer = await getViewer();
  if (!viewer || !canManageDepartments(viewer)) return null;

  return withViewer(viewer, async (tx) => {
    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    // Head candidates: any employee, keyed by their userId (headUserId → User.id).
    const employees = await tx.employee.findMany({
      where: { orgId: viewer.orgId },
      select: { userId: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    return {
      parentOptions: departments,
      headOptions: employees.map((e) => ({ userId: e.userId, name: `${e.firstName} ${e.lastName}` })),
    };
  });
}

// Prefill + candidates for the "edit department" form. Gated to HR_ADMIN. Self + descendants are
// excluded from the parent options so the UI can't offer a cycle (the action re-checks anyway).
export async function getDepartmentForEdit(id: string) {
  const viewer = await getViewer();
  if (!viewer || !canManageDepartments(viewer)) return null;

  return withViewer(viewer, async (tx) => {
    const department = await tx.department.findUnique({
      where: { id },
      select: { id: true, name: true, parentDepartmentId: true, headUserId: true },
    });
    if (!department) return null;

    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    const allDepartments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true, parentDepartmentId: true },
      orderBy: { name: "asc" },
    });
    const employees = await tx.employee.findMany({
      where: { orgId: viewer.orgId },
      select: { userId: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    // HR_ADMIN passes app_can_see_budget for every dept, so this returns the row if it exists.
    const budgetRow = await tx.departmentBudget.findUnique({ where: { departmentId: id }, select: { budget: true } });

    const blocked = departmentDescendantIds(id, allDepartments); // self + descendants
    return {
      department: {
        id: department.id,
        name: department.name,
        parentDepartmentId: department.parentDepartmentId,
        headUserId: department.headUserId,
        budget: budgetRow?.budget?.toString() ?? "",
      },
      parentOptions: allDepartments.filter((d) => !blocked.has(d.id)),
      headOptions: employees.map((e) => ({ userId: e.userId, name: `${e.firstName} ${e.lastName}` })),
    };
  });
}

// --- Audit log (read side) ---------------------------------------------------------------

const AUDIT_PAGE_SIZE = 25;

// RLS hides ROWS, not JSON contents: an audit diff can carry a salary the viewer isn't
// entitled to (e.g. HR_GENERALIST reading a superior's UPDATE). Same guard as the profile,
// applied to the before/after payloads.
const COMP_KEYS = new Set([
  "salary",
  "currency",
  "payBasis",
  "lastReviewDate",
  "nextReviewDate",
  "equityNote",
]);
function redactComp(state: Prisma.JsonValue): Prisma.JsonValue {
  if (!state || typeof state !== "object") return state;
  return Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, COMP_KEYS.has(k) ? REDACTED : v]),
  );
}

// One page of an employee's audit trail, newest first. Cursor-paginated: we fetch one row
// beyond the page size purely to learn whether a next page exists, then drop it. The
// cursor is the last row's id — stable because the log is append-only (new rows land at
// the top; a cursor row can never move or disappear, unlike OFFSET pages).
// Wrapped in cache() so the page body and generateMetadata share one execution.
// Returns null when RLS hides the employee (→ 404), like the profile.
export const getEmployeeAuditLog = cache(async (employeeId: string, cursor: string | null = null) => {
  const viewer = await getViewer();
  if (!viewer) return null;

  return withViewer(viewer, async (tx) => {
    // Lean fetch on purpose — NOT getEmployeeOverview, which writes a VIEW audit row for
    // payroll viewers. Reading the log must never add to the log.
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        departmentId: true, // for the comp-access check below
      },
    });
    if (!employee) return null;

    const rows = await tx.employeeAuditLog.findMany({
      where: { employeeId },
      // id desc breaks ties for events sharing an occurredAt (batch inserts) so the
      // order — and therefore the cursor — is fully deterministic.
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: AUDIT_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), // skip the cursor row itself
      select: {
        id: true,
        eventType: true,
        actorType: true,
        occurredAt: true,
        beforeState: true,
        afterState: true,
        actor: { select: { name: true } },
      },
    });

    const hasMore = rows.length > AUDIT_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;

    const canViewComp = await resolveCompAccess(
      viewer,
      { id: employee.id, departmentId: employee.departmentId },
      tx,
    );

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
      },
      events: page.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        actorType: r.actorType,
        actorName: r.actor?.name ?? "—",
        occurredAt: r.occurredAt,
        beforeState: canViewComp ? r.beforeState : redactComp(r.beforeState),
        afterState: canViewComp ? r.afterState : redactComp(r.afterState),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      canViewComp,
    };
  });
});

// Options for the "new employee" form. Gated to HR (also gates the /employees/new route).
export async function getNewEmployeeFormData() {
  const viewer = await getViewer();
  if (!viewer || !canEditEmployee(viewer)) return null;

  return withViewer(viewer, async (tx) => {
    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const all = await tx.employee.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    return {
      departments,
      managerOptions: all.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
      canEditComp: canEditCompensation(viewer),
    };
  });
}
