import { getT } from "@/lib/i18n.server";
import { NotFoundBox } from "@hris/ui/server";

// App-wide 404. Rendered for unmatched URLs and for notFound() calls in routes without a
// more-specific not-found.js. Note: getX loaders that return null on an unauthorized viewer
// also land here — we don't reveal which.
export default async function NotFound() {
  const t = await getT();
  return (
    <NotFoundBox
      title={t("notFound.title")}
      body={t("notFound.body")}
      backHref="/employees"
      backLabel={t("notFound.back")}
    />
  );
}
