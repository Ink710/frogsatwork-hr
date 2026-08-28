import { LoadingPage } from "@hris/ui/server";

// The apply form: FOUR awaited reads (session, job, questions, saved profile) before anything
// renders — the heaviest public page in the app.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="form" width="max-w-3xl" />;
}
