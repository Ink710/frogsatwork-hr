import { redirect } from "next/navigation";
import { getLandingPath } from "@/lib/queries";

// Post-login dispatcher. This route is auth-protected (see proxy.js), so only signed-in users
// reach it — we send each to their role-appropriate home: employees → own profile, managers →
// their department, HR/payroll → the employee list.
export default async function Home() {
  redirect(await getLandingPath());
}
