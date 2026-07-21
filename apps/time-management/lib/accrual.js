import "server-only";
import { SYSTEM_USER_ID } from "@hris/database";
import { withViewer } from "@hris/auth";
import { computeAccrual } from "@hris/workable-hours";

// The current accrual period as "YYYY-MM" (UTC).
export function currentPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Post one month's ACCRUAL ledger rows for every active employee × accruing policy in an org.
//
// Runs as a synthetic SYSTEM viewer: role SYSTEM passes app_can_see_employee for everyone in the
// org, so the RLS WITH CHECK admits writes for all employees. Idempotent by construction — the
// LeaveLedgerEntry `@@unique([employeeId, type, accrualPeriod])` plus createMany({skipDuplicates})
// means re-running the same period inserts nothing (and createMany issues no RETURNING, so the
// insert-visibility RLS gotcha never applies). Returns { period, created }.
export async function runAccrualForOrg(orgId, period = currentPeriod()) {
  const systemViewer = { userId: SYSTEM_USER_ID, employeeId: null, role: "SYSTEM", orgId };

  return withViewer(systemViewer, async (tx) => {
    const policies = (await tx.leavePolicy.findMany({ where: { orgId } })).filter((p) => p.accrues);
    if (policies.length === 0) return { period, created: 0 };

    const employees = await tx.employee.findMany({
      where: { orgId, employmentStatus: { not: "TERMINATED" } },
      select: { id: true, hireDate: true },
    });

    // Balance per (employee, type) for the cap, in one grouped query.
    const sums = await tx.leaveLedgerEntry.groupBy({ by: ["employeeId", "type"], _sum: { hours: true } });
    const balance = {};
    for (const s of sums) balance[`${s.employeeId}:${s.type}`] = Number(s._sum.hours ?? 0);

    const effectiveDate = new Date(`${period}-01T00:00:00.000Z`);
    const rows = [];
    for (const emp of employees) {
      for (const pol of policies) {
        const hours = computeAccrual({
          policy: {
            accrualHoursPerMonth: Number(pol.accrualHoursPerMonth),
            maxBalanceHours: pol.maxBalanceHours != null ? Number(pol.maxBalanceHours) : null,
            accrues: pol.accrues,
          },
          hireDate: emp.hireDate,
          period,
          currentBalance: balance[`${emp.id}:${pol.type}`] ?? 0,
        });
        rows.push({
          employeeId: emp.id,
          type: pol.type,
          hours: hours.toFixed(2),
          source: "ACCRUAL",
          note: `Monthly accrual ${period}`,
          effectiveDate,
          accrualPeriod: period,
          createdById: SYSTEM_USER_ID,
        });
      }
    }

    const result = await tx.leaveLedgerEntry.createMany({ data: rows, skipDuplicates: true });
    return { period, created: result.count };
  });
}
