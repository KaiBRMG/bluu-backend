'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import RefreshButton from '@/components/admin/training/RefreshButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useTrainingModules } from '@/hooks/useTrainingAdmin';
import { SURFACE, SURFACE_INTERACTIVE } from '@/lib/surfaces';
import { getTest } from '@/lib/training/modules';
import { cn } from '@/lib/utils';

/**
 * Training: the modules a candidate can be sat on. A module is a switch — on lets
 * approved candidates in, off is a hard stop — and holds tests that open one at a
 * time. The switch itself, the tests and the roster live on the module's page, so
 * turning a module off is always done with the running attempts in view. "Open all
 * tests" sits here, above the modules: it opens every test on every module that is on. The
 * candidate side lives at /training (documentation/training.md).
 */
export default function AdminTrainingPage() {
  const { modules, error, refreshing, refetch, refresh, openingAll, setAllTestsOpen } = useTrainingModules();
  const [switching, setSwitching] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const live = modules?.filter((m) => m.isOn) ?? [];
  const allOpen = live.length > 0 && live.every((m) => m.allTestsOpen);

  async function toggleAll(next: boolean) {
    setSwitching(true);
    try {
      await setAllTestsOpen(next);
      toast.success(next ? 'All tests are open' : 'Back to one test at a time');
      setConfirmOn(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the switch');
    } finally {
      setSwitching(false);
    }
  }

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

        {modules && modules.length > 0 && (
          <section aria-labelledby="open-all-heading" className={cn('mb-4 rounded-xl p-5', SURFACE)}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="open-all-heading" className="text-base font-semibold">
                  Open all tests
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {live.length === 0
                    ? 'Switch a module on first.'
                    : 'Every test is open to candidates who haven’t started it. Tests someone has already submitted stay submitted. Turning it off leaves running clocks to finish.'}
                </p>
              </div>
              <label className="mt-0.5 flex shrink-0 items-center gap-3 text-sm font-medium">
                <span aria-hidden>{allOpen ? 'On' : 'Off'}</span>
                <Switch
                  checked={allOpen}
                  disabled={switching || live.length === 0}
                  aria-labelledby="open-all-heading"
                  onCheckedChange={(next) => (next ? setConfirmOn(true) : void toggleAll(false))}
                />
              </label>
            </div>
          </section>
        )}

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
                    {m.allTestsOpen
                      ? ' · all tests are open'
                      : m.openTestId
                        ? ` · ${m.openTestId} ${getTest(m.id, m.openTestId)?.title ?? ''} is open`
                        : m.isOn
                          ? ' · no test open'
                          : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmOn} onOpenChange={(open) => !switching && setConfirmOn(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open all tests?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone on {live.map((m) => m.title).join(', ')} can start any test they haven’t started yet, as soon as this
              finishes. Each test can be sat once. Every test’s files are copied from Drive first, which can take a minute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {openingAll && (
            <div className="flex flex-col gap-1.5 text-xs" role="status" aria-live="polite">
              <span className="text-zinc-200 tabular-nums">
                {openingAll.total === 0 ? 'Reading Drive…' : `Copying ${openingAll.done} / ${openingAll.total} files`}
              </span>
              {openingAll.total > 0 && (
                <Progress value={(openingAll.done / openingAll.total) * 100} className="h-1.5" aria-label="Files copied" />
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={switching}
              onClick={(e) => {
                e.preventDefault();
                void toggleAll(true);
              }}
            >
              {switching ? 'Opening…' : 'Open all tests'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
