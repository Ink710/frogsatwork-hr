import { LoadingPage } from "@hris/ui/server";

// The public job list — the suite's front door, and the page a stranger lands on cold. It is the
// one segment where a blank first paint is most likely and least forgivable.
//
// ⚠️ IT LIVES IN A ROUTE GROUP, AND THAT IS THE WHOLE POINT. This file was originally at app/ root,
// where it wrapped EVERY route in a loading boundary — including /jobs/[id]. A loading boundary
// makes the response STREAM, so the 200 headers are flushed before the page body runs; a later
// notFound() then renders the correct "Not found" UI but can no longer change the status code.
// /jobs/bogus returned 200 in production as a result: a soft 404 that invites crawlers to index
// dead job URLs as live pages.
//
// `(browse)` changes no URL — this still serves "/" — but it scopes the boundary to this page
// alone, so /jobs/* sits outside it and returns a real 404 again. Verified with a production build:
// with the boundary above /jobs, /jobs/bogus is 200; without it, 404, while /jobs/job-be stays 200.
//
// ⚠️ DO NOT add a loading.js at app/ root, or to any segment above a route that calls notFound().
// The portal's two are under /portal, which is behind auth and never 404s.
// `width` matches the page's own container so the skeleton does not jump on swap.
export default function Loading() {
  return <LoadingPage variant="list" width="max-w-4xl" />;
}
