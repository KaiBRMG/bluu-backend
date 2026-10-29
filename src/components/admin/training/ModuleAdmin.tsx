'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, Loader2, TriangleAlert } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useTrainingModule } from '@/hooks/useTrainingAdmin';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { SURFACE } from '@/lib/surfaces';
import { getTest, TRAINING_MODULES, type TrainingModuleId } from '@/lib/training/modules';
import type { AdminParticipant } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import AddPeopleDialog from './AddPeopleDialog';
import CandidateSheet from './CandidateSheet';
import RefreshButton from './RefreshButton';
import Roster from './Roster';
import TestsStrip from './TestsStrip';

const TRAINING_URL = `${PUBLIC_APP_ORIGIN}/training`;

/**
 * One training module: the switch, the tests that open one at a time, and the
 * roster of everyone on it. Rendered inside the page's `AppLayout` and
 * `<Suspense>` (the route param is read on the server — see the page).
 */
export default function ModuleAdmin({ moduleId }: { moduleId: TrainingModuleId }) {
  const { timezone } = useViewerTimezone();
  const mod = TRAINING_MODULES[moduleId];
  const { detail, skewMs, error, preparing, refreshing, refetch, refresh, setOn, check, openTest, closeTest, reopen, addPeople, revoke, retryMirror, loadSubmission } =
    useTrainingModule(moduleId);

  const [copied, setCopied] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [removing, setRemoving] = useState<AdminParticipant | null>(null);
  const [reopening, setReopening] = useState<{ person: AdminParticipant; testId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <Link
      href="/admin-portal/training"
      prefetch={false}
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 outline-none hover:text-zinc-200 focus-visible:text-white"
    >
      <ArrowLeft className="size-3.5" />
      Training
    </Link>
  );

  if (error && !detail) {
    return (
      <div className="max-w-6xl">
        {header}
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{mod.title}</h1>
        <div role="alert" className={cn('rounded-xl p-6', SURFACE)}>
          <p className="text-sm font-medium text-red-400">Couldn&apos;t load this module</p>
          <p className="mt-1 text-sm text-zinc-400">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="max-w-6xl" aria-hidden>
        {header}
        <Skeleton className="mb-6 h-14 w-72" />
        <Skeleton className="mb-6 h-72 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  const live = detail.participants.filter((p) => p.revokedAtMs == null);
  const running = live.filter((p) => Object.values(p.tests).some((c) => c.state === 'in-progress')).length;
  const viewingPerson = detail.participants.find((p) => p.emailHash === viewing) ?? null;
  const { isOn } = detail.module;

  async function toggle(next: boolean) {
    setSwitching(true);
    try {
      await setOn(next);
      toast.success(next ? `${mod.title} is on` : `${mod.title} is off`);
      setConfirmOff(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the switch');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <div className="max-w-6xl">
        {header}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight">{mod.title}</h1>
            <p className="text-sm text-zinc-400 tabular-nums">
              {isOn ? 'On — approved candidates can sign in.' : 'Off — nobody can sign in.'} · {live.length}{' '}
              {live.length === 1 ? 'person' : 'people'}
              {detail.module.openTestId ? ` · ${detail.module.openTestId} is open` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-4">
            <RefreshButton onClick={refresh} refreshing={refreshing} />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(TRAINING_URL);
                  setCopied(true);
                  toast.success('Training link copied');
                  window.setTimeout(() => setCopied(false), 1600);
                } catch {
                  toast.error('Could not copy. The link is ' + TRAINING_URL);
                }
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy link
            </Button>
            <label className="flex items-center gap-3 text-sm font-medium">
              <span aria-hidden>{isOn ? 'On' : 'Off'}</span>
              <Switch
                checked={isOn}
                disabled={switching}
                aria-label={`${mod.title} module`}
                onCheckedChange={(next) => (next ? void toggle(true) : setConfirmOff(true))}
              />
            </label>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-400/30 bg-orange-400/10 px-4 py-3 text-sm text-orange-200">
            <span className="flex items-center gap-2">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              Couldn’t refresh, so this is the last read. {error}
            </span>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </div>
        )}

        <TestsStrip detail={detail} preparing={preparing} timezone={timezone} onOpen={openTest} onClose={closeTest} onCheck={check} />

        <section aria-labelledby="people-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="people-heading" className="text-lg font-semibold">
              People
            </h2>
            <AddPeopleDialog onAdd={addPeople} />
          </div>
          {!isOn && (
            <Alert className="mb-3 border-orange-400/30 bg-orange-400/10 text-orange-200">
              <TriangleAlert className="size-4" aria-hidden />
              <AlertTitle>Candidates can’t sign in yet</AlertTitle>
              <AlertDescription className="text-orange-200">
                People added here get no invitation email and can’t sign in until this module is live. Switch {mod.title} on when you are ready for them
                to start.
              </AlertDescription>
            </Alert>
          )}
          {detail.participants.length === 0 ? (
            <div className={cn('rounded-xl p-8 text-center', SURFACE)}>
              <p className="text-sm font-medium">No one is on this module yet</p>
              <p className="mt-1 text-sm text-zinc-400">Add the email addresses of the people you have approved.</p>
            </div>
          ) : (
            <Roster
              detail={detail}
              skewMs={skewMs}
              onView={(p) => setViewing(p.emailHash)}
              onReopen={(person, testId) => setReopening({ person, testId })}
              onRemove={setRemoving}
              onRestore={async (person) => {
                try {
                  await addPeople(person.email);
                  toast.success(`${person.name ?? person.email} restored`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not restore');
                }
              }}
            />
          )}
        </section>
      </div>

      <CandidateSheet
        moduleId={moduleId}
        person={viewingPerson}
        skewMs={skewMs}
        timezone={timezone}
        load={loadSubmission}
        onRetry={retryMirror}
        refreshing={refreshing}
        onRefresh={refresh}
        onClose={() => setViewing(null)}
      />

      <AlertDialog open={confirmOff} onOpenChange={(open) => !switching && setConfirmOff(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch {mod.title} off?</AlertDialogTitle>
            <AlertDialogDescription>
              {running > 0
                ? `${running} ${running === 1 ? 'attempt is' : 'attempts are'} running and will end now. `
                : 'Nobody is mid-test. '}
              Nobody can sign in, and any open test is closed. Work already uploaded is kept, and uploads already on their way
              are saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>Keep it on</AlertDialogCancel>
            <AlertDialogAction
              disabled={switching}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void toggle(false);
              }}
            >
              {switching && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Switch off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reopening} onOpenChange={(open) => !busy && !open && setReopening(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen for {reopening?.person.name ?? reopening?.person.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              {reopening && getTest(moduleId, reopening.testId)?.title} restarts on a fresh{' '}
              {Math.round((getTest(moduleId, reopening?.testId ?? '')?.durationMs ?? 0) / 60_000)} minutes. They keep what they
              have already uploaded. Use this when their machine crashed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (!reopening) return;
                setBusy(true);
                try {
                  await reopen(reopening.person.emailHash, reopening.testId);
                  toast.success('Reopened');
                  setReopening(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not reopen');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removing} onOpenChange={(open) => !busy && !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name ?? removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access straight away, even if they are signed in. Anything they already submitted is kept here, and you
              can restore them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!removing) return;
                setBusy(true);
                try {
                  await revoke(removing.emailHash);
                  toast.success('Access removed');
                  setRemoving(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not remove access');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
