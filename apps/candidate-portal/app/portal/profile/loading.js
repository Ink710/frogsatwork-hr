import { LoadingPage } from "@hris/ui/server";

// The profile editor — session, profile and résumé, all awaited.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="form" width="max-w-3xl" />;
}
