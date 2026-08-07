import { CardSkeleton } from "@hris/ui/server";

export default function Loading() {
  return (
    <div className="space-y-6">
      <CardSkeleton />
      <CardSkeleton rows={2} />
    </div>
  );
}
