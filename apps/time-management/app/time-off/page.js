import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getTimeOffOverview } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/profile-ui";
import { LeaveStatusBadge } from "@/components/time-off-ui";
import { CancelRequestButton } from "@/components/CancelRequestButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("timeOff.title")} · FrogsAtWorkHR` };
}

export default async function TimeOffPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [overview, t, localeCode] = await Promise.all([getTimeOffOverview(), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];

  // No employee record on this account (e.g. an HR-only or SYSTEM login) → nothing personal to show.
  if (!overview) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("timeOff.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("timeOff.noRecord")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("timeOff.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("timeOff.subtitle")}</p>
        </div>
        <Link
          href="/time-off/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {t("timeOff.request")}
        </Link>
      </header>

      {/* Balances per leave type */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overview.balances.map((b) => (
          <Card key={b.type} title={t(`enum.leaveType.${b.type}`)}>
            <p className="text-3xl font-semibold tracking-tight font-mono tabular-nums">{formatHours(b.available)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("timeOff.available")}</p>
            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
              {b.pending > 0 && (
                <div className="flex justify-between">
                  <dt>{t("timeOff.pending")}</dt>
                  <dd className="font-mono tabular-nums text-warning">{formatHours(b.pending)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>{t("timeOff.used")}</dt>
                <dd className="font-mono tabular-nums">{formatHours(b.used)}</dd>
              </div>
              {b.accrues && (
                <div className="flex justify-between">
                  <dt>{t("timeOff.perMonth")}</dt>
                  <dd className="font-mono tabular-nums">{formatHours(b.accrualHoursPerMonth)}</dd>
                </div>
              )}
            </dl>
          </Card>
        ))}
      </section>

      {/* Request history */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("timeOff.myRequests")}
        </h2>
        {overview.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("timeOff.noRequests")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {overview.requests.map((r) => {
              const cancellable =
                (overview.isSelf || overview.canFileOnBehalf) && (r.status === "PENDING" || r.status === "APPROVED");
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t(`enum.leaveType.${r.type}`)} · <span className="font-mono tabular-nums">{formatHours(r.hours)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.startDate, locale)} – {formatDate(r.endDate, locale)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <LeaveStatusBadge status={r.status} label={t(`timeOff.status.${r.status}`)} />
                    {cancellable && <CancelRequestButton requestId={r.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
