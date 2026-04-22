import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="max-w-5xl p-8 flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <div className="flex gap-2 mt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-lg mt-2" />
    </div>
  );
}
