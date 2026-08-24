// Recruitment-campaign vocabulary and validation (M2). The channel list mirrors the Prisma
// SourceChannel enum; the slug rules are what keep a tracking link's ?source= value safe to accept
// from a stranger.
import { z } from "zod";

// The reportable classification. Order matters: it is the order the admin UI offers them in, and
// the roll-up on /reports follows it, so "where do applicants come from" reads the same everywhere.
export const SOURCE_CHANNELS = [
  "CAREERS_PAGE",
  "COMPANY_WEBSITE",
  "REFERRAL",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "JOB_BOARD",
  "OTHER",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

// A slug is the ONLY part of a campaign a stranger can put in a URL, so it is the part with real
// rules: lowercase alphanumerics in hyphen-separated groups, nothing else.
//
// The shape does the security work rather than a blocklist. No dots, no slashes and no whitespace
// means a slug can never be a path fragment, and no uppercase means `?source=LinkedIn` and
// `?source=linkedin` cannot become two campaigns that look identical in a report. The length cap is
// what stops a megabyte of junk arriving on a public endpoint.
//
// Leading/trailing/doubled hyphens are rejected rather than trimmed: two slugs differing only by
// punctuation would render identically in the campaign list, and a recruiter picking the wrong one
// would mis-attribute a whole campaign with no visible mistake.
export const CAMPAIGN_SLUG_MAX = 40;
export const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const campaignSlugSchema = z
  .string()
  .trim()
  .min(1, "A slug is required.")
  .max(CAMPAIGN_SLUG_MAX, `Keep the slug to ${CAMPAIGN_SLUG_MAX} characters or fewer.`)
  .regex(CAMPAIGN_SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens (e.g. linkedin-march-grads).");

export const campaignSchema = z.object({
  // A CHANNEL LABEL, never a person — see the Campaign model comment. Campaign names outlive an
  // erasure by design, so "Referral — Maria Gomez" would put a name somewhere erasure cannot reach.
  name: z.string().trim().min(1, "A name is required.").max(80),
  slug: campaignSlugSchema,
  channel: z.enum(SOURCE_CHANNELS),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

// Suggest a slug from a display name, for the admin form's convenience only. Never trusted as
// validation — whatever it produces still goes through campaignSlugSchema, because the value that
// actually reaches the database can come from anywhere.
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    // Strip accents so "Referências" becomes "referencias" rather than losing the letters entirely.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CAMPAIGN_SLUG_MAX)
    // A trailing hyphen can reappear after the slice, and would fail the pattern.
    .replace(/-+$/g, "");
}
