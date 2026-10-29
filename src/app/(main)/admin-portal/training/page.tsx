'use client';

import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrainingModules } from '@/hooks/useTrainingAdmin';
import { getTest } from '@/lib/training/modules';

/**
 * Training: the modules a candidate can be sat on. A module is a switch — on lets
 * approved candidates in, off is a hard stop — and holds tests that open one at a
 * time. The switch itself, the tests and the roster live on the module's page, so
 * turning a module off is always done with the running attempts in view. The
 * candidate side lives at /training (documentation/training.md).
 */
export default function AdminTrainingPage() {
  const { modules, error, refetch } = useTrainingModules();

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Training</h1>
          <p className="text-sm text-zinc-400">Switch a module on, open its tests one at a time, and watch how each person is getting on.</p>
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-6">
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
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/admin-portal/training/${m.id}`}
                  prefetch={false}
                  className="block rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 outline-none transition-colors hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-blue-400/60"
                >
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
