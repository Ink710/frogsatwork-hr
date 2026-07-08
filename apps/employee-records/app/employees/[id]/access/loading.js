import { CardSkeleton } from "@/components/profile-ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <CardSkeleton />
      <CardSkeleton rows={2} />
    </div>
  );
}
