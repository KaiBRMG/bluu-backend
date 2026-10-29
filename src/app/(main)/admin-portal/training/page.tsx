'use client';

import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import RefreshButton from '@/components/admin/training/RefreshButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrainingModules } from '@/hooks/useTrainingAdmin';
import { SURFACE, SURFACE_INTERACTIVE } from '@/lib/surfaces';
import { getTest } from '@/lib/training/modules';
import { cn } from '@/lib/utils';

/**
 * Training: the modules a candidate can be sat on. A module is a switch — on lets
 * approved candidates in, off is a hard stop — and holds tests that open one at a
 * time. The switch itself, the tests and the roster live on the module's page, so
 * turning a module off is always done with the running attempts in view. The
 * candidate side lives at /training (documentation/training.md).
 */
export default function AdminTrainingPage() {
  const { modules, error, refreshing, refetch, refresh } = useTrainingModules();

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight">Training</h1>
            <p className="text-sm text-zinc-400">Switch a module on, open its tests one at a time, and watch how each person is getting on.</p>
          </div>
          <RefreshButton onClick={refresh} refreshing={refreshing} className="shrink-0" />
        </div>

        {error ? (
          <div role="alert" className={cn('rounded-xl p-6', SURFACE)}>
            <p className="text-sm font-medium text-red-400">Couldn&apos;t load the modules</p>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : !modules ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : modules.length === 0 ? (
          <div className={cn('rounded-xl p-8 text-center', SURFACE)}>
            <p className="text-sm font-medium">No training modules yet</p>
            <p className="mt-1 text-sm text-zinc-400">Modules are defined in code, so there is nothing to switch on here until one ships.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.id}>
                <Link href={`/admin-portal/training/${m.id}`} prefetch={false} className={cn('block rounded-xl p-5', SURFACE, SURFACE_INTERACTIVE)}>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold">{m.title}</h2>
                    <Badge
                      variant="outline"
                      className={`font-medium ${m.isOn ? 'border-blue-400/30 bg-blue-400/10 text-blue-300' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}
                    >
                      {m.isOn ? 'On' : 'Off'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-400 tabular-nums">
                    {m.participantCount} {m.participantCount === 1 ? 'person' : 'people'}
                    {m.openTestId ? ` · ${m.openTestId} ${getTest(m.id, m.openTestId)?.title ?? ''} is open` : m.isOn ? ' · no test open' : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}
