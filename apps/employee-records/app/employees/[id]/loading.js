import { CardSkeleton } from "@hris/ui/server";

// Fallback for the Overview tab content (renders inside the profile layout's content slot).
export default function Loading() {
  return (
    <div className="space-y-6">
      <CardSkeleton rows={6} />
      <CardSkeleton />
    </div>
  );
}
