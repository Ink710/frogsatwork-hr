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
  "portal.subtitle": "Where each of your applications stands.",
  "portal.empty": "We don't have any applications on file for you right now.",
  "portal.appliedOn": "Applied {date}",
  "portal.signOut": "Sign out",
  "portal.closingMessage":
    "Thank you for your application. After reviewing your qualifications, we have decided not to move forward with your application for this position. We appreciate your interest and encourage you to apply for future opportunities.",

  // The applicant-facing names for pipeline stages. ⚠️ These are PUBLIC copy: adding a stage to
  // ApplicationStage breaks packages/recruiting/src/portal.test.js until a label is decided here.
  "enum.applicantStage.APPLIED": "Applied",
  "enum.applicantStage.SCREEN": "Screening",
  "enum.applicantStage.INTERVIEW": "Interview",
  "enum.applicantStage.OFFER": "Offer",
  "enum.applicantStage.HIRED": "Hired",
  "enum.applicantStage.REJECTED": "Not selected",
  "enum.applicantStage.WITHDRAWN": "Withdrawn",
  "enum.applicantStage.UNKNOWN": "In progress",

  // Apply flow (M6)
  "apply.title": "Apply",
  "apply.prefilled": "We've filled this in from your profile — edit anything that's out of date.",
  "apply.firstName": "First name",
  "apply.lastName": "Last name",
  "apply.email": "Email",
  "apply.phone": "Phone (optional)",
  "apply.experience": "Work experience",
  "apply.experienceHint": "Most recent first. Add as many roles as you'd like us to see.",
  "apply.employer": "Employer",
  "apply.jobTitle": "Job title",
  "apply.startMonth": "Start month",
  "apply.endMonth": "End month",
  "apply.summary": "What you did there (optional)",
  "apply.leaveEndBlank": "Leave the end month blank if you still work there.",
  "apply.addRole": "+ Add a role",
  "apply.education": "Education",
  "apply.institution": "Institution",
  "apply.qualification": "Qualification",
  "apply.addStudy": "+ Add education",
  "apply.remove": "Remove",
  "apply.questions": "A few questions from the team",
  "apply.choose": "Choose…",
  "apply.yes": "Yes",
  "apply.no": "No",
  "apply.missingAnswers": "Please answer the required questions.",
  "apply.resume": "Résumé (PDF or Word, optional)",
  "apply.note": "Anything else you'd like us to know (optional)",
  "apply.consent": "I've read the privacy notice and agree to FrogsAtWork processing my data for this application.",
  "apply.submit": "Submit application",
  "apply.submitting": "Submitting…",
  "apply.eeoTitle": "Voluntary self-identification",
  "apply.eeoHint": "Entirely optional, never seen by the people reviewing your application, and used only for anonymous reporting.",
  "apply.eeo.gender": "Gender",
  "apply.eeo.ethnicity": "Ethnicity",
  "apply.eeo.veteran": "Veteran status",
  "apply.eeo.disability": "Disability status",
  "apply.invalid": "Please check the form and try again.",
  "apply.consentRequired": "Please accept the privacy notice to apply.",
  "apply.duplicate": "You've already applied for this role.",
  "apply.closed": "This role is no longer accepting applications.",
  "apply.failed": "We couldn't submit your application. Please try again.",
  "apply.rateLimited": "Too many attempts just now. Please try again shortly.",
  "apply.fileTooLarge": "That file is too large (5 MB maximum).",
  "apply.fileType": "Please upload a PDF or Word document.",
  "applied.title": "Application received",
  "applied.body": "Thanks — we've got it. You'll hear from us as things move along.",
  "applied.track": "Track this application →",
  "enum.eeo.DECLINED": "Prefer not to say",
  "enum.eeo.MALE": "Male",
  "enum.eeo.FEMALE": "Female",
  "enum.eeo.NON_BINARY": "Non-binary",
  "enum.eeo.WHITE": "White",
  "enum.eeo.ASIAN": "Asian",
  "enum.eeo.HISPANIC_OR_LATINO": "Hispanic or Latino",
  "enum.eeo.BLACK_OR_AFRICAN_AMERICAN": "Black or African American",
  "enum.eeo.TWO_OR_MORE_RACES": "Two or more races",
  "enum.eeo.NOT_A_VETERAN": "Not a veteran",
  "enum.eeo.PROTECTED_VETERAN": "Protected veteran",
  "enum.eeo.NO": "No",
  "enum.eeo.YES": "Yes",

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
