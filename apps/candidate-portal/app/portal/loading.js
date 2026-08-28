import { LoadingPage } from "@hris/ui/server";

// The applicant dashboard, and the heaviest segment here: applications, interviews and schedulable
// slots are three separate SECURITY DEFINER doorway calls.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="cards" width="max-w-4xl" />;
}
