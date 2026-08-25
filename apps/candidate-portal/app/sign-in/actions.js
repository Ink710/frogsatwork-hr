"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@hris/database";
import { sendMail } from "@hris/notifications";
import { getT } from "@/lib/i18n.server";
import { generateLoginToken, loginLink } from "@/lib/tokens";
import { allowLoginLinkRequest } from "@/lib/rate-limit";

// Ask for a login link.
//
// ⚠️ THIS ENDPOINT MUST NEVER REVEAL WHETHER AN ADDRESS IS IN OUR DATABASE. Every path below —
// found, not found, erased, closed, rate-limited, mail server on fire — ends at the SAME
// confirmation page. "We don't have that address" would turn a public form into a way to ask "has
// this person applied to your company?", which is the exact question apps/ats/app/careers/erasure
// was built never to answer. This is that discipline applied a second time.
//
// The layering is the same as the public apply path, cheapest rejection first: a free format check,
// then one Redis op, then the database doorway.
export async function requestLoginLink(_prevState, formData) {
  const t = await getT();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // The ONE thing worth reporting back. A malformed address reveals nothing about our data, and
  // silently swallowing it would strand someone who simply mistyped — they would sit waiting for an
  // email that was never going to arrive.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: t("signin.invalidEmail") };
  }

  // Per-IP throttle. Note this is NOT keyed on the email: keying on the address would put a
  // harvested address list into Redis, and would let an attacker lock a specific person out of
  // their own login by burning their budget.
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  if (!(await allowLoginLinkRequest(ip))) {
    // Deliberately the SAME redirect as success. A distinct "too many attempts" message would still
    // be a signal, and the honest user experience is unchanged: they were told a link is coming,
    // and one is not, exactly as when the address is unknown.
    redirect("/sign-in/sent");
  }

  const { raw, hash, expires } = generateLoginToken();

  // Bare prisma — there is no viewer, and "Candidate" is under RLS, so this MUST go through the
  // SECURITY DEFINER doorway or it would match nothing. The cast is required: the function's
  // parameter is timestamp(3) and the driver sends a JS Date as timestamptz.
  let result;
  let firstName = null;
  try {
    const rows = await prisma.$queryRaw`
      SELECT result, first_name
      FROM app_issue_candidate_login(${email}, ${hash}, ${expires}::timestamp(3))`;
    result = rows[0]?.result;
    firstName = rows[0]?.first_name ?? null;
  } catch (e) {
    // LOG IT, tell them nothing. A failure here must not become a signal either — but an operator
    // needs the cause, which is the lesson from an outage where three tidy catch blocks left the
    // platform logs empty.
    console.error("[sign-in] issuing a login link failed", e);
    redirect("/sign-in/sent");
  }

  if (result === "OK") {
    const link = loginLink(raw);
    try {
      await sendMail({
        to: email,
        subject: "Your FrogsAtWork sign-in link",
        text:
          `Hi${firstName ? ` ${firstName}` : ""},\n\n` +
          `Here is your link to sign in and track your applications:\n${link}\n\n` +
          `It works once and expires in 30 minutes. If you didn't ask for it, you can ignore this email.`,
        html:
          `<p>Hi${firstName ? ` ${firstName}` : ""},</p>` +
          `<p>Here is your link to sign in and track your applications:</p>` +
          `<p><a href="${link}">Sign in to FrogsAtWork</a></p>` +
          `<p style="color:#71717a;font-size:13px">It works once and expires in 30 minutes. ` +
          `If you didn't ask for it, you can ignore this email.</p>`,
      });
    } catch (e) {
      // Same posture: the applicant is told the same thing regardless, but the operator gets the
      // real error. A token was minted and will simply go unused, expiring in 30 minutes.
      console.error("[sign-in] sending the login link failed", e);
    }
  }

  redirect("/sign-in/sent");
}
