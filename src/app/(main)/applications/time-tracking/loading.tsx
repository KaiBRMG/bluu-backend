import { Skeleton } from "@/components/ui/skeleton";
import { SURFACE } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

/** Shaped to the page: title, the ring + side panel, the tab strip and rows. */
export default function TimeTrackingLoading() {
  return (
    <div className="w-full max-w-5xl p-8">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className={cn("mt-8 flex items-center gap-10 rounded-xl p-8", SURFACE)}>
        <Skeleton className="size-[300px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-6">
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
      <div className="mt-10 flex gap-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="mt-5 space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}
