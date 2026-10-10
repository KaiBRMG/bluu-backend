import AppLayout from '@/components/AppLayout';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a model board shows while the route resolves its params on the server:
 * the app shell plus the board's own card skeletons, so the window never
 * blanks (a `null` fallback would drop the sidebar too — the view renders its
 * own `AppLayout`).
 */
export function LlmPromptsFallback() {
  return (
    <AppLayout>
      <div className="space-y-4">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <div className="columns-1 [column-gap:0.75rem] sm:columns-2 lg:columns-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="mb-3 h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
