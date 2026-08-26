import Link from "next/link";
import { redirect } from "next/navigation";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { getApplicant } from "@/lib/auth";
import { getT, getLocale } from "@/lib/i18n.server";
import { getMyApplications, getMyInterviews, getMySchedulableSlots } from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-ui";
import { SignOutButton } from "@/components/SignOutButton";
import { InterviewTime } from "@/components/InterviewTime";
import { SlotPicker } from "@/components/SlotPicker";

export const metadata = { title: "Your applications · FrogsAtWorkHR" };

// The private area — what this whole app exists for.
//
// ⚠️ THE SESSION CHECK HERE IS NOT REDUNDANT WITH THE PROXY. The proxy is an edge gate; this is the
// page refusing to render without an applicant, which is the same "never trust the outer layer for
// authorization" rule the staff apps follow by re-checking roles server-side. And a third layer sits
// underneath both: the doorway functions scope every row to this account id, so even a page that
// forgot to check would have nothing to show.
export default async function PortalPage() {
  const applicant = await getApplicant();
  if (!applicant) redirect("/sign-in");

  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const applications = await getMyApplications(applicant.accountId);
  // M9: one extra doorway call, keyed by application, rather than a query per card.
  const interviews = await getMyInterviews(applicant.accountId);
  // M11: times still open to them. The doorway returns NOTHING for a round already booked, so these
  // two are mutually exclusive per round without the page having to reason about it.
  const schedulable = await getMySchedulableSlots(applicant.accountId);

  // ⚠️ Shown only when a contact actually exists. Telling someone to "get in touch" without saying
  // where is the dead end this milestone existed to close — our own mail comes from no-reply@.
  const contact = process.env.RECRUITING_REPLY_TO ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("portal.title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("portal.subtitle")}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/portal/profile" className="text-sm text-primary hover:underline">
              {t("portal.editProfile")}
            </Link>
            <SignOutButton />
          </div>
        </div>

        {/* A signed-in applicant with no applications is a real state — an account only exists for
            someone who applied, so this means their record was archived out of reach or something
            genuinely odd happened. Say so plainly rather than rendering an empty page. */}
        {applications.length === 0 ? (
          <p className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {t("portal.empty")}
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {applications.map((app) => (
              <li key={app.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium">{app.jobTitle}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[app.jobLocation, t("portal.appliedOn", { date: formatDate(app.appliedAt, locale) })]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      app.terminal ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {t(`enum.applicantStage.${app.statusKey}`)}
                  </span>
                </div>

                {/* M8: the in-portal half of a stage notification. Derived from the same event
                    trail the timeline below renders, so it stores nothing and needs no read state.
                    ⚠️ It carries the STAGE ONLY — never a rejection reason or category, which M5
                    established are written by recruiters for colleagues and are not for the person
                    they describe. A rejection shows the standard courtesy message further down. */}
                {app.latestUpdate && !app.closingMessage && (
                  <p className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    {t("portal.latestUpdate", {
                      stage: t(`enum.applicantStage.${app.latestUpdate.key}`),
                      date: formatDate(app.latestUpdate.occurredAt, locale),
                    })}
                  </p>
                )}

                {/* M9 — the interview they actually have. Published and claimed only; the doorway
                    will not return anything a recruiter has merely proposed. */}
                {(interviews.get(app.id) ?? []).map((iv, i) => (
                  <InterviewTime key={`${app.id}-${i}`} interview={iv} locale={locale} />
                ))}

                {/* M11 — the once-only rule, stated NEXT TO the booked time rather than saved for a
                    refusal. Julian's requirement is that a reschedule attempt is told to contact
                    whoever is following up; saying it here means most people never reach the
                    refusal at all. The doorway still answers ALREADY_BOOKED if they do. */}
                {(interviews.get(app.id) ?? []).length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {contact
                      ? t("schedule.booked", { contact })
                      : t("schedule.bookedNoContact")}
                  </p>
                )}

                {/* …and the picker, only while nothing is booked for this round. */}
                <SlotPicker slots={schedulable.get(app.id) ?? []} locale={locale} />

                {/* The timeline. Round names are never here — see app_applicant_events — so an
                    applicant sees that they reached the interview stage, not how our process is
                    built. Consecutive round advances have already collapsed into one entry. */}
                {app.timeline.length > 0 && (
                  <ol className="mt-4 flex flex-col gap-2 border-l border-border pl-4">
                    {app.timeline.map((step, i) => (
                      <li key={`${step.key}-${i}`} className="text-sm">
                        <span className="font-medium">{t(`enum.applicantStage.${step.key}`)}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {formatDate(step.occurredAt, locale)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                {/* Shown ONLY for a rejection. The internal category that feeds /reports is
                    deliberately not surfaced: it is chosen in one click for analytics, not written
                    to be read by the person it describes. */}
                {app.closingMessage && (
                  <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    {t("portal.closingMessage")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
