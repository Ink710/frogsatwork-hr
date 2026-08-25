import { Readable } from "node:stream";
import { createStorage } from "@hris/storage";
import { getApplicant } from "@/lib/auth";
import { getMyResume } from "@/lib/queries";

const storage = createStorage();

/**
 * Download the CV on the signed-in applicant's own profile.
 *
 * ⚠️ IT LIVES UNDER /portal BECAUSE IT HAS TO. This app's proxy matcher is the INVERSE of the other
 * three: it matches ONLY `/portal/:path*`, so a route anywhere else — `/api/resume`, say, which is
 * the shape the ATS uses — would be served to anyone who asked. Read `proxy.js` before adding any
 * authenticated route here.
 *
 * ⚠️ AND IT IS DELIBERATELY UNSIGNED, unlike the ATS's résumé route. That one HMAC-signs its links
 * because the URL names a candidate id belonging to SOMEONE ELSE, so the signature binds the link to
 * one staff user and one short expiry. This route names nothing at all: it takes no id, no query,
 * no body, and resolves the file from the session's own account through a doorway. There is no
 * parameter to tamper with, so a signature would protect against nothing and would only suggest the
 * URL is the security boundary. The doorway is.
 *
 * Two gates remain, and they are the real ones: the proxy turns away anyone without a session, and
 * `app_applicant_resume` returns nothing for an account that is closed or a candidate that has been
 * erased — which is the only place either can be enforced, since sessions are stateless JWTs.
 */
export async function GET() {
  const applicant = await getApplicant();
  if (!applicant) return new Response("Unauthorized", { status: 401 });

  const resume = await getMyResume(applicant.accountId);

  // One 404 for "no CV on file", "account closed" and "record erased". Nothing is being protected by
  // collapsing them here — it is the applicant's own record — but there is no useful distinction to
  // draw either, and the page above already tells them whether a CV is on file.
  if (!resume) return new Response("Not found", { status: 404 });

  let nodeStream;
  try {
    nodeStream = await storage.getStream(resume.key);
  } catch (e) {
    // The row says there is a file and storage disagrees. Log the cause — a 404 with nothing behind
    // it in the platform logs is indistinguishable from "no CV" to whoever has to fix it.
    console.error("[portal-resume] storage read failed", { key: resume.key, error: e });
    return new Response("Résumé unavailable", { status: 404 });
  }

  return new Response(Readable.toWeb(nodeStream), {
    headers: {
      "Content-Type": "application/octet-stream",
      // Display-only, and never part of the storage path — the key is a server-generated UUID. The
      // quote strip keeps a filename from breaking out of the header.
      "Content-Disposition": `attachment; filename="${resume.fileName.replace(/"/g, "")}"`,
      // Personal data through a serverless function: Vercel's default still STORES the response.
      "Cache-Control": "private, no-store",
      // The bytes are a user upload and always sent as a download; don't let a browser sniff its way
      // to executing one.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
