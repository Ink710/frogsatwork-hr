// English dictionary for the ATS (recruiting) app. Flat dot-keyed strings, same shape as the other
// suite apps. Kept lean — generic shell keys (login/prefs/error/nav/role) + the recruiting domain.
const en = {
  "brand.slogan": "Let’s jump into it.",

  // Nav / shell
  "nav.home": "Jobs",
  "nav.jobs": "Jobs",
  "nav.candidates": "Candidates",
  "nav.preferences": "Preferences",
  "nav.signOut": "Sign out",

  // Roles (shown next to the signed-in user's name)
  "enum.role.EMPLOYEE": "Employee",
  "enum.role.MANAGER": "Manager",
  "enum.role.HR_GENERALIST": "HR Generalist",
  "enum.role.HR_ADMIN": "HR Admin",
  "enum.role.PAYROLL_ADMIN": "Payroll Admin",
  "enum.role.RECRUITER": "Recruiter",
  "enum.role.SYSTEM": "System",

  // Login
  "login.title": "Sign in",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.invalid": "Invalid email or password.",
  "login.rateLimited": "Too many attempts. Please wait a moment and try again.",
  "login.activated": "Your account is ready — sign in to continue.",
  "login.seededHint": "Demo accounts (password: password123)",

  // Preferences
  "prefs.title": "Preferences",
  "prefs.subtitle": "Personalize how the app looks and reads for you.",
  "prefs.appearance": "Appearance",
  "prefs.appearanceHelp": "Choose a theme or follow your device.",
  "prefs.language": "Language",
  "prefs.languageHelp": "Switch the interface language.",
  "prefs.theme.light": "Light",
  "prefs.theme.lightHint": "Always light.",
  "prefs.theme.dark": "Dark",
  "prefs.theme.darkHint": "Always dark.",
  "prefs.theme.system": "System",
  "prefs.theme.systemHint": "Follow your device.",

  // Error / not-found boundaries
  "error.title": "Something went wrong",
  "error.generic": "An unexpected error occurred. Please try again.",
  "error.tryAgain": "Try again",
  "notFound.title": "Not found",
  "notFound.body": "That page doesn’t exist or you don’t have access to it.",
  "notFound.back": "← Back to Jobs",

  // Jobs list (landing)
  "jobs.title": "Jobs",
  "jobs.subtitle": "Requisitions you’re on. Open one to see its pipeline.",
  "jobs.empty": "You’re not on any hiring teams yet.",
  "jobs.openings": "{n} opening(s)",
  "jobs.applications": "{n} in pipeline",
  "jobs.viewBoard": "View pipeline →",

  // Pipeline board
  "board.back": "← All jobs",
  "board.pipeline": "Pipeline",
  "board.emptyColumn": "None",
  "board.closed": "Closed",
  "board.round": "Round",
  "board.readOnly": "You have view-only access to this pipeline.",
  "board.appliedOn": "Applied {date}",
  "board.source": "Source: {source}",
  "board.viewCandidate": "View →",

  // Move actions
  "action.advance": "Advance",
  "action.advanceTo": "Advance to {stage}",
  "action.reject": "Reject",
  "action.withdraw": "Withdraw",
  "action.nextRound": "Next round",
  "action.advanceToOffer": "Advance to Offer",

  // Candidate database
  "candidates.title": "Candidates",
  "candidates.subtitle": "Everyone who has applied. Search past applicants, not just active ones.",
  "candidates.count": "{n} people · showing {shown}",
  "candidates.search": "Search name or email",
  "candidates.allStages": "All stages",
  "candidates.allJobs": "All jobs",
  "candidates.allSources": "All sources",
  "candidates.appliedFrom": "Applied from",
  "candidates.appliedTo": "Applied to",
  "candidates.filter": "Filter",
  "candidates.clear": "Clear",
  "candidates.empty": "No candidates yet.",
  "candidates.noMatch": "No candidates match those filters.",
  "candidates.moreApplications": "+{n} more",
  "candidates.applications": "{n} application(s)",
  "candidates.noApplications": "No applications",

  // Candidate profile
  "profile.back": "← All candidates",
  "profile.details": "Candidate",
  "profile.history": "Application history",
  "profile.applicationsLabel": "Applications",
  "profile.appliedOn": "Applied {date}",
  "profile.round": "Round",
  "profile.rejectionReason": "Reason",
  "profile.viewPipeline": "View in pipeline →",

  // Application detail
  "app.title": "Candidate",
  "app.timeline": "Pipeline history",
  "app.appliedOn": "Applied {date}",
  "app.appliedLabel": "Applied on",
  "app.source": "Source",
  "app.phone": "Phone",
  "app.email": "Email",
  "app.currentStage": "Current stage",
  "app.currentRound": "Current round",
  "app.event.moved": "{from} → {to}",
  "app.event.applied": "Applied",
  "app.event.round": "Interview round: {round}",

  // Stages
  "enum.applicationStage.APPLIED": "Applied",
  "enum.applicationStage.SCREEN": "Screen",
  "enum.applicationStage.INTERVIEW": "Interview",
  "enum.applicationStage.OFFER": "Offer",
  "enum.applicationStage.HIRED": "Hired",
  "enum.applicationStage.REJECTED": "Rejected",
  "enum.applicationStage.WITHDRAWN": "Withdrawn",

  // Job status
  "enum.jobStatus.DRAFT": "Draft",
  "enum.jobStatus.OPEN": "Open",
  "enum.jobStatus.PAUSED": "Paused",
  "enum.jobStatus.CLOSED": "Closed",
  "enum.jobStatus.FILLED": "Filled",

  // Errors (server actions)
  "err.notAuthorized": "You can’t manage this job’s pipeline.",
  "err.applicationNotFound": "Application not found.",
  "err.invalidTransition": "That isn’t a valid move for this stage.",
  "err.notInterview": "This application isn’t in the interview stage.",
  "err.atLastRound": "Already at the last interview round — advance to Offer instead.",
  "err.invalidInput": "Please check the form and try again.",
  "err.moveFailed": "Couldn’t update the application. Please try again.",
};

export default en;
