import { LoadingPage } from "@hris/ui/server";

// A single posting. Two awaited reads (the job, the locale) behind a public URL people share.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="detail" width="max-w-4xl" />;
}
