import Link from "next/link";
import { IdCard, Building2, UserRound, MapPin, Calendar, Clock, Mail, Phone } from "lucide-react";
import { formatDate, tenureParts, initials } from "@/lib/format";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { Avatar, StatusBadge } from "@/components/profile-ui";

// Lucide icons (outline, 2px) keyed by the sidebar's field names.
const ICONS = {
  id: IdCard,
  building: Building2,
  user: UserRound,
  pin: MapPin,
  calendar: Calendar,
  clock: Clock,
  mail: Mail,
  phone: Phone,
};

function InfoRow({ icon, label, children }) {
  const Icon = ICONS[icon];
  return (
    <div className="flex gap-3">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium">{children ?? "—"}</div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

// The persistent left identity rail. Rendered by the [id] layout, so it stays put while the
// user switches tabs. `s` is the lean summary from getEmployeeSummary (no compensation).
export async function EmployeeSidebar({ s }) {
  const [t, localeCode] = await Promise.all([getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];

  const parts = tenureParts(s.hireDate, s.terminationDate);
  let tenure = null;
  if (parts) {
    const out = [];
    if (parts.years) out.push(t(parts.years === 1 ? "tenure.year" : "tenure.years", { n: parts.years }));
    if (parts.months) out.push(t(parts.months === 1 ? "tenure.month" : "tenure.months", { n: parts.months }));
    tenure = out.length ? out.join(" ") : t("tenure.lessThanMonth");
  }

  return (
    <aside className="w-full">
      {/* Identity */}
      <div className="flex flex-col items-center text-center">
        <Avatar initials={initials(s.firstName, s.lastName)} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{s.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">{s.title ?? "—"}</p>
        <div className="mt-2">
          <StatusBadge status={s.employmentStatus} label={t(`enum.status.${s.employmentStatus}`)} />
        </div>
      </div>

      <hr className="my-6 border-border" />

      {/* Employee info */}
      <SectionLabel>{t("profile.employeeInfo")}</SectionLabel>
      <div className="space-y-4">
        <InfoRow icon="id" label={t("profile.employeeId")}>
          <span className="font-mono">{s.employeeNumber}</span>
        </InfoRow>
        <InfoRow icon="building" label={t("profile.department")}>{s.department}</InfoRow>
        <InfoRow icon="user" label={t("profile.reportsTo")}>
          {s.manager ? (
            <Link href={`/employees/${s.manager.id}`} className="text-primary hover:underline ">
              {s.manager.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoRow>
        <InfoRow icon="pin" label={t("profile.location")}>{s.location}</InfoRow>
        <InfoRow icon="calendar" label={t("profile.hireDate")}>{formatDate(s.hireDate, locale)}</InfoRow>
        <InfoRow icon="clock" label={t("profile.tenure")}>{tenure}</InfoRow>
      </div>

      <hr className="my-6 border-border" />

      {/* Contact */}
      <SectionLabel>{t("profile.contact")}</SectionLabel>
      <div className="space-y-4">
        <InfoRow icon="mail" label={t("profile.workEmail")}>
          <a href={`mailto:${s.email}`} className="text-primary hover:underline ">
            {s.email}
          </a>
        </InfoRow>
        <InfoRow icon="phone" label={t("profile.phone")}>{s.phone}</InfoRow>
      </div>
    </aside>
  );
}
