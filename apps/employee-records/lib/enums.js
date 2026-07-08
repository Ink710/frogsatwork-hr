// Client-safe [value, label] option lists for the schema enums. Shared by the create / change /
// correct forms so the labels stay consistent in one place. (Values mirror @hris/types.)
export const EMPLOYMENT_TYPE_OPTIONS = [
  ["FULL_TIME", "Full time"],
  ["PART_TIME", "Part time"],
  ["CONTRACT", "Contract"],
  ["INTERN", "Intern"],
];

export const FLSA_OPTIONS = [
  ["EXEMPT", "Exempt"],
  ["NON_EXEMPT", "Non-exempt"],
];

export const PAY_FREQUENCY_OPTIONS = [
  ["WEEKLY", "Weekly"],
  ["BIWEEKLY", "Biweekly"],
  ["SEMI_MONTHLY", "Semi-monthly"],
  ["MONTHLY", "Monthly"],
];

export const PAY_BASIS_OPTIONS = [
  ["PER_HOUR", "Per hour"],
  ["PER_MONTH", "Per month"],
  ["PER_YEAR", "Per year"],
];

export const ROLE_OPTIONS = [
  ["EMPLOYEE", "Employee"],
  ["MANAGER", "Manager"],
  ["HR_GENERALIST", "HR generalist"],
  ["HR_ADMIN", "HR admin"],
  ["PAYROLL_ADMIN", "Payroll admin"],
];
