import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-screen w-full">
      {/* Sidebar skeleton */}
      <div className="w-64 shrink-0 border-r p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--sidebar-background)' }}>
        <Skeleton className="h-8 w-32 mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-8 flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="mt-4 grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-lg mt-2" />
      </div>
    </div>
  );
}
