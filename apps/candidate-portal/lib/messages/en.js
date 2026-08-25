// English dictionary for the candidate portal.
//
// This app owns its own dictionary rather than importing the ATS one, matching how every app in the
// suite works. The overlap is small and deliberate: only the strings a PUBLIC visitor sees. Internal
// recruiting vocabulary (stages, scorecards, offers) has no business being shipped to a client here
// — every app sends its whole dictionary to the browser, so a key that exists is a key a stranger
// can read.
const en = {
  // Site shell
  "site.name": "FrogsAtWork",
  "site.tagline": "Open roles",
  "nav.roles": "Roles",

  // Job listing (the front door)
  "careers.title": "Open roles",
  "careers.subtitle": "Join us — here's what we're hiring for right now.",
  "careers.empty": "No open roles right now. Please check back soon.",
  "careers.posted": "Posted {date}",
  "careers.view": "View role →",
  "careers.back": "← All roles",

  // Job detail
  "job.apply": "Apply for this role",
  "job.applyHint": "Applications are handled on our careers site.",

  // Sign in (M4) — passwordless, one-time emailed link
  "signin.title": "Sign in",
  "signin.subtitle": "Enter the email you applied with and we'll send you a link. No password needed.",
  "signin.email": "Email",
  "signin.submit": "Email me a link",
  "signin.sending": "Sending…",
  "signin.invalidEmail": "Enter a valid email address.",
  "signin.sentTitle": "Check your email",
  "signin.sentBody":
    "If we have an application for that address, a sign-in link is on its way.",
  "signin.sentHint": "The link works once and expires in 30 minutes.",
  "signin.invalidTitle": "That link didn't work",
  "signin.invalidBody":
    "Sign-in links can only be used once and expire after 30 minutes. Request a fresh one and it'll work.",
  "signin.requestAnother": "Request a new link →",

  // The private portal
  "portal.title": "Your applications",
  "portal.placeholder": "You're signed in. Your application timeline lands here next.",
  "portal.signOut": "Sign out",

  // Errors
  "error.title": "Something went wrong",
  "error.generic": "An unexpected error occurred. Please try again.",
  "error.tryAgain": "Try again",
  "notFound.title": "Not found",
  "notFound.body": "That role isn’t open any more, or the link is wrong.",
  "notFound.back": "← Back to roles",

  // Enums shown on a public posting
  "enum.employmentType.FULL_TIME": "Full time",
  "enum.employmentType.PART_TIME": "Part time",
  "enum.employmentType.CONTRACT": "Contract",
  "enum.employmentType.INTERN": "Intern",
  "enum.payBasis.PER_HOUR": "per hour",
  "enum.payBasis.PER_MONTH": "per month",
  "enum.payBasis.PER_YEAR": "per year",
};

export default en;
