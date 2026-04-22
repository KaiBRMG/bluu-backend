import { Skeleton } from "@/components/ui/skeleton";

export default function TimeTrackingLoading() {
  return (
    <div className="max-w-5xl p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>
      {/* Clock widget */}
      <Skeleton className="h-28 w-full rounded-lg" />
      {/* Timeline */}
      <Skeleton className="h-20 w-full rounded-lg" />
      {/* Timesheet table */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
