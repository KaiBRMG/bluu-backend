import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import ModuleAdmin from '@/components/admin/training/ModuleAdmin';
import { Skeleton } from '@/components/ui/skeleton';
import { getModule, type TrainingModuleId } from '@/lib/training/modules';

/**
 * One training module — `/admin-portal/training/[moduleId]`, inheriting the
 * `training` page permission by path.
 *
 * The id is read here, on the server, and passed down: under Cache Components
 * `params` must be awaited inside `<Suspense>` (same split as
 * `fan-analytics/[fanKey]`). Everything that moves lives in `ModuleAdmin`.
 */
export default function AdminTrainingModulePage({ params }: { params: Promise<{ moduleId: string }> }) {
  return (
    <AppLayout>
      <Suspense fallback={<ModuleFallback />}>
        <ResolvedModule params={params} />
      </Suspense>
    </AppLayout>
  );
}

async function ResolvedModule({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  if (!getModule(moduleId)) notFound();
  return <ModuleAdmin moduleId={moduleId as TrainingModuleId} />;
}

function ModuleFallback() {
  return (
    <div className="max-w-6xl" aria-hidden>
      <Skeleton className="mb-6 h-14 w-72" />
      <Skeleton className="mb-6 h-72 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
