import { LoadingPage } from "@hris/ui/server";

// The public job list — the suite's front door, and the page a stranger lands on cold. It is the
// one segment where a blank first paint is most likely and least forgivable.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="list" width="max-w-4xl" />;
}
