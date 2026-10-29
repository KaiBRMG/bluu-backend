'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, ExternalLink, Loader2, MonitorPlay, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SURFACE } from '@/lib/surfaces';
import { TRAINING_MODULES, type TestDef, type TrainingModuleId } from '@/lib/training/modules';
import type { AdminAttemptCell, AdminParticipant, AdminSubmissionView } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { AdminStateBadge } from './AdminStateBadge';
import RecordingPlayer from './RecordingPlayer';
import RefreshButton from './RefreshButton';
import SubmissionSlots from './SubmissionSlots';
import { TimeLeft } from './TimeLeft';
import { formatDuration, formatWhen } from './zonedTime';

interface CandidateSheetProps {
  moduleId: TrainingModuleId;
  person: AdminParticipant | null;
  skewMs: number;
  timezone: string;
  load: (emailHash: string, testId: string) => Promise<AdminSubmissionView>;
  onRetry: (emailHash: string, testId: string) => Promise<number>;
  /** Re-reads the roster; the sheet re-reads the open work and recording with it. */
  onRefresh: () => void;
  refreshing: boolean;
  onClose: () => void;
}

/** The facts about an attempt that are not the work itself, as one line. */
function attemptFacts(c: AdminAttemptCell, timezone: string): string {
  const facts: string[] = [];
  if (c.startedAtMs) facts.push(`started ${formatWhen(c.startedAtMs, timezone)}`);
  if (c.startedAtMs && c.finishedAtMs) facts.push(`finished early after ${formatDuration(c.finishedAtMs - c.startedAtMs)}`);
  if (c.reopenedAtMs) facts.push(`reopened ${formatWhen(c.reopenedAtMs, timezone)}`);
  return facts.join(' · ');
}

/**
 * One candidate's work, test by test. A panel rather than a page, so the roster
 * stays on screen behind it (DESIGN.md: a peek, not a departure). A test's work
 * is read only when it is opened, and re-read while it is live, so a running
 * test shows its uploads and state as they land.
 */
export default function CandidateSheet({ moduleId, person, skewMs, timezone, load, onRetry, onRefresh, refreshing, onClose }: CandidateSheetProps) {
  // Bumped by Refresh: the open work and any recording player read again, even when nothing on the roster moved.
  const [nonce, setNonce] = useState(0);
  const display = person ? (person.name ?? person.email) : '';
  return (
    <Sheet open={!!person} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="flex-row items-center gap-3 border-b border-white/[0.07] py-4 pr-12 pl-6">
          {person && (
            <Avatar className="size-11 shrink-0" style={{ background: getAvatarColor(display) }}>
              <AvatarFallback style={{ background: getAvatarColor(display), color: '#fff' }}>{getInitials(display)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{display}</SheetTitle>
            <SheetDescription className="truncate">
              {person?.name ? `${person.email} · ` : ''}
              {person && !person.name ? 'Has not signed in yet' : TRAINING_MODULES[moduleId].title}
            </SheetDescription>
          </div>
          {person && (
            <RefreshButton
              className="shrink-0"
              refreshing={refreshing}
              onClick={() => {
                setNonce((n) => n + 1);
                onRefresh();
              }}
            />
          )}
        </SheetHeader>
        {person && (
          <Body key={person.emailHash} moduleId={moduleId} person={person} skewMs={skewMs} timezone={timezone} load={load} onRetry={onRetry} nonce={nonce} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  moduleId,
  person,
  skewMs,
  timezone,
  load,
  onRetry,
  nonce,
}: Pick<CandidateSheetProps, 'moduleId' | 'skewMs' | 'timezone' | 'load' | 'onRetry'> & { person: AdminParticipant; nonce: number }) {
  // One player at a time: each one polls while live, and a panel of them would all load video at once.
  const [watching, setWatching] = useState<string | null>(null);
  const tests = TRAINING_MODULES[moduleId].tests.filter((t) => person.tests[t.id]?.startedAtMs != null);

  if (tests.length === 0) {
    return <p className="p-6 text-sm text-zinc-400">They have not started any test.</p>;
  }
  return (
    <div className="flex flex-col gap-4 p-6">
      {tests.map((t) => (
        <TestWork
          key={t.id}
          moduleId={moduleId}
          test={t}
          person={person}
          cell={person.tests[t.id]!}
          skewMs={skewMs}
          timezone={timezone}
          load={load}
          onRetry={onRetry}
          nonce={nonce}
          watching={watching === t.id}
          onWatch={() => setWatching((w) => (w === t.id ? null : t.id))}
        />
      ))}
    </div>
  );
}

function TestWork({
  moduleId,
  test,
  person,
  cell,
  skewMs,
  timezone,
  load,
  onRetry,
  nonce,
  watching,
  onWatch,
}: {
  moduleId: TrainingModuleId;
  test: TestDef;
  person: AdminParticipant;
  cell: AdminAttemptCell;
  skewMs: number;
  timezone: string;
  load: CandidateSheetProps['load'];
  onRetry: CandidateSheetProps['onRetry'];
  nonce: number;
  watching: boolean;
  onWatch: () => void;
}) {
  const [open, setOpen] = useState(cell.state === 'in-progress');
  const [sub, setSub] = useState<AdminSubmissionView | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const facts = attemptFacts(cell, timezone);

  // Read when opened and again whenever the roster says something moved (an upload, the mirror, the state).
  const stamp = `${cell.state}|${cell.slotsFilled}|${cell.mirror}`;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    load(person.emailHash, test.id)
      .then((res) => {
        if (!cancelled) {
          setSub(res);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load their work');
      });
    return () => {
      cancelled = true;
    };
  }, [open, stamp, nonce, load, person.emailHash, test.id]);

  return (
    <section className={cn('rounded-xl p-4', SURFACE)} aria-labelledby={`tw-${test.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`tw-${test.id}`} className="text-sm font-semibold">
          {test.id} · {test.title}
        </h3>
        <AdminStateBadge state={cell.state} />
      </div>
      {(facts || (cell.state === 'in-progress' && cell.deadlineMs)) && (
        <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">
          {facts}
          {cell.state === 'in-progress' && cell.deadlineMs && (
            <>
              {facts ? ' · ' : ''}
              <TimeLeft deadlineMs={cell.deadlineMs} skewMs={skewMs} /> left
              {cell.slotsTotal > 0 ? ` · ${cell.slotsFilled} of ${cell.slotsTotal} uploaded` : ''}
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-pressed={watching} onClick={onWatch}>
          <MonitorPlay className="size-4" />
          {watching ? 'Hide recording' : cell.state === 'in-progress' ? 'Watch live' : 'Screen recording'}
        </Button>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          {open ? 'Hide work' : 'View work'}
        </Button>
        {cell.mirror && cell.mirror !== 'synced' && (
          <Button
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry(person.emailHash, test.id);
                toast.success('Copied to Drive');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not copy to Drive');
              } finally {
                setRetrying(false);
              }
            }}
          >
            {retrying ? <Loader2 className="activity-spinner size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Retry Drive copy
          </Button>
        )}
        {sub?.driveUrl && (
          <>
            <Button variant="ghost" size="sm" asChild>
              <a href={sub.driveUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                Drive folder
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy link to the Drive folder"
              onClick={() => {
                navigator.clipboard.writeText(sub.driveUrl!).then(
                  () => toast.success('Drive link copied'),
                  () => toast.error('Could not copy'),
                );
              }}
            >
              <Copy className="size-4" />
              Copy link
            </Button>
          </>
        )}
      </div>

      {watching && (
        <div className="mt-3">
          <RecordingPlayer key={nonce} moduleId={moduleId} emailHash={person.emailHash} testId={test.id} timezone={timezone} testTitle={test.title} />
        </div>
      )}

      {open && (
        <div className="mt-4">
          {error && !sub ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : !sub ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400" role="status">
              <Loader2 className="activity-spinner size-4 animate-spin" /> Loading
            </p>
          ) : (
            <SubmissionSlots test={test} submission={sub} timezone={timezone} />
          )}
        </div>
      )}
    </section>
  );
}
