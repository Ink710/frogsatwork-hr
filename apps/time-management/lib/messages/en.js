// English dictionary (flat key → template string, {var} interpolation). Starter set for the M0
// shell; each domain milestone adds its own keys, and M6 does the full i18n pass.
const en = {
  "brand.slogan": "Let’s jump into it.",

  // Header nav (grows as each domain milestone lands).
  "nav.home": "My time",
  "nav.timeOff": "Time off",
  "nav.approvals": "Approvals",
  "nav.policies": "Policies",
  "nav.preferences": "Preferences",
  "nav.signOut": "Sign out",

  // Role labels (shown next to the user's name in the header).
  "enum.role.EMPLOYEE": "Employee",
  "enum.role.MANAGER": "Manager",
  "enum.role.HR_GENERALIST": "HR Generalist",
  "enum.role.HR_ADMIN": "HR Admin",
  "enum.role.PAYROLL_ADMIN": "Payroll Admin",
  "enum.role.SYSTEM": "System",

  // Login.
  "login.title": "Sign in",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.invalid": "Invalid email or password.",
  "login.activated": "Your account is ready — sign in to continue.",
  "login.seededHint": "Demo accounts (password: password123)",

  // Preferences.
  "prefs.title": "Preferences",
  "prefs.subtitle": "Personal settings for this device.",
  "prefs.appearance": "Appearance",
  "prefs.appearanceHelp": "Choose a theme, or follow your system setting.",
  "prefs.language": "Language",
  "prefs.languageHelp": "Choose the language for the interface.",
  "prefs.theme.system": "System",
  "prefs.theme.systemHint": "Follow your operating system’s light/dark setting.",
  "prefs.theme.light": "Light",
  "prefs.theme.lightHint": "Always use the light theme.",
  "prefs.theme.dark": "Dark",
  "prefs.theme.darkHint": "Always use the dark theme.",

  // Home shell.
  "home.title": "My time",
  "home.subtitle": "Time off, timesheets, attendance, and scheduling — all in one place.",
  "home.greeting": "Welcome, {name}",
  "home.comingSoon": "Coming soon",
  "home.card.timeOff": "Time off",
  "home.card.timeOffDesc": "Request vacation and sick days, and track your balances.",
  "home.card.timesheets": "Timesheets",
  "home.card.timesheetsDesc": "Log hours and submit weekly timesheets for approval.",
  "home.card.schedule": "Schedule",
  "home.card.scheduleDesc": "See your upcoming shifts and request swaps.",
  "home.card.attendance": "Attendance",
  "home.card.attendanceDesc": "Clock in and out, and review your daily attendance.",

  // Leave types.
  "enum.leaveType.VACATION": "Vacation",
  "enum.leaveType.SICK": "Sick",
  "enum.leaveType.PERSONAL": "Personal",
  "enum.leaveType.UNPAID": "Unpaid",

  // Time off — overview.
  "timeOff.title": "Time off",
  "timeOff.subtitle": "Your balances and requests.",
  "timeOff.request": "Request time off",
  "timeOff.available": "Available",
  "timeOff.pending": "Pending",
  "timeOff.used": "Used",
  "timeOff.perMonth": "Accrues / mo",
  "timeOff.myRequests": "My requests",
  "timeOff.noRequests": "No requests yet.",
  "timeOff.noRecord": "Your account isn’t linked to an employee record, so there’s no time off to show.",
  "timeOff.status.PENDING": "Pending",
  "timeOff.status.APPROVED": "Approved",
  "timeOff.status.DENIED": "Denied",
  "timeOff.status.CANCELLED": "Cancelled",
  "timeOff.cancel": "Cancel",

  // Approvals queue.
  "approvals.title": "Approvals",
  "approvals.subtitle": "Time-off requests awaiting your decision.",
  "approvals.empty": "Nothing to approve right now.",
  "approvals.approve": "Approve",
  "approvals.deny": "Deny",
  "approvals.notePlaceholder": "Note (optional)",
  "approvals.overdraw": "Exceeds their available balance ({available}).",

  // Accrual policies.
  "policies.title": "Leave policies",
  "policies.subtitle": "How each type of leave accrues.",
  "policies.accrualHeading": "Accrual rates",
  "policies.colType": "Type",
  "policies.colAccrual": "Accrues / month",
  "policies.colCap": "Max balance",
  "policies.noAccrual": "No accrual",
  "policies.uncapped": "Uncapped",
  "policies.runHeading": "Run accrual",
  "policies.runHelp": "Post this month’s accrual now. Safe to run repeatedly — each month is applied once.",
  "policies.runAccrual": "Run accrual now",
  "policies.accrualDone": "Accrued {period}: {created} entries posted.",

  // Time off — new request.
  "timeOff.new.title": "Request time off",
  "timeOff.new.subtitle": "Pick your dates; hours fill in from business days and can be adjusted.",
  "timeOff.new.type": "Type",
  "timeOff.new.start": "Start date",
  "timeOff.new.end": "End date",
  "timeOff.new.hours": "Hours",
  "timeOff.new.hoursHint": "Auto-filled from business days (8h/day). Adjust for half-days.",
  "timeOff.new.reason": "Reason (optional)",
  "timeOff.new.forEmployee": "For employee",
  "timeOff.new.self": "Myself",
  "timeOff.new.submit": "Submit request",
  "timeOff.new.overdrawWarning": "This exceeds your available balance ({available}). It can still be submitted for approval.",
};

export default en;
