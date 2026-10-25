import { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import SessionView from '@/components/admin/training/SessionView';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One training session — `/admin-portal/training/[sessionId]`, inheriting the
 * `training` page permission by path.
 *
 * The id is read here, on the server, and passed down: under Cache Components
 * `params` must be awaited inside `<Suspense>` (same split as
 * `fan-analytics/[fanKey]`). Everything that moves lives in `SessionView`.
 */
export default function AdminTrainingSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <AppLayout>
      <Suspense fallback={<SessionFallback />}>
        <ResolvedSession params={params} />
      </Suspense>
    </AppLayout>
  );
}

async function ResolvedSession({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionView sessionId={sessionId} />;
}

function SessionFallback() {
  return (
    <div className="max-w-6xl" aria-hidden>
      <Skeleton className="mb-6 h-14 w-72" />
      <Skeleton className="mb-6 h-40 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
