'use client';

import { useState } from 'react';
import { Loader2, MonitorPlay } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTrainingCandidate } from '@/hooks/useTrainingAdmin';
import { getPart, TRAINING_MODULES } from '@/lib/training/modules';
import type { AdminCandidatePart, AdminCandidateRow } from '@/lib/training/types';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { AdminStateBadge } from './AdminStateBadge';
import RecordingPlayer from './RecordingPlayer';
import SubmissionSlots from './SubmissionSlots';
import { formatDuration, formatWhen } from './zonedTime';

/** The facts about an attempt that are not the work itself, as one Meta line. */
function attemptFacts(p: AdminCandidatePart, timezone: string): string {
  const facts: string[] = [];
  if (p.startedAtMs) facts.push(`started ${formatWhen(p.startedAtMs, timezone)}`);
  if (p.startedAtMs && p.finishedAtMs) facts.push(`finished early after ${formatDuration(p.finishedAtMs - p.startedAtMs)}`);
  if (p.state === 'in-progress' && p.deadlineMs) facts.push(`ends ${formatWhen(p.deadlineMs, timezone)}`);
  if (p.reopenedAtMs) facts.push(`reopened ${formatWhen(p.reopenedAtMs, timezone)}`);
  return facts.join(' · ');
}

/**
 * One candidate across every session: each part they have been given, its state,
 * and what they handed in. A panel, not a page, so the candidate list stays on
 * screen behind it (DESIGN.md: a peek rather than a departure). The body is
 * keyed by the person, so opening another candidate is a clean instance.
 */
export default function CandidateSheet({
  candidate,
  timezone,
  onClose,
}: {
  candidate: AdminCandidateRow | null;
  timezone: string;
  onClose: () => void;
}) {
  const display = candidate ? (candidate.name ?? candidate.email) : '';
  const seed = candidate ? (candidate.name ?? candidate.email) : '';

  return (
    <Sheet open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="flex-row items-center gap-3 border-b border-white/[0.07] py-4 pr-12 pl-6">
          {candidate && (
            <Avatar className="size-11 shrink-0" style={{ background: getAvatarColor(seed) }}>
              <AvatarFallback style={{ background: getAvatarColor(seed), color: '#fff' }}>{getInitials(seed)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <SheetTitle className="truncate">{display}</SheetTitle>
            <SheetDescription className="truncate">
              {candidate?.name ? `${candidate.email} · ` : ''}
              {candidate && !candidate.name ? 'Has not signed in yet' : 'All sessions'}
            </SheetDescription>
          </div>
        </SheetHeader>
        {candidate && <CandidateBody key={candidate.emailHash} emailHash={candidate.emailHash} timezone={timezone} />}
      </SheetContent>
    </Sheet>
  );
}

function CandidateBody({ emailHash, timezone }: { emailHash: string; timezone: string }) {
  // One player at a time: each one polls while live, and a panel of them would all load video at once.
  const [watching, setWatching] = useState<string | null>(null);
  const { detail, error, refetch } = useTrainingCandidate(emailHash);

  if (error) {
    return (
      <div role="alert" className="p-6">
        <p className="text-sm font-medium text-red-400">Couldn&apos;t load this candidate</p>
        <p className="mt-1 text-sm text-zinc-400">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
          Try again
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="activity-spinner size-5 animate-spin text-zinc-400" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      {detail.sessions.map((session) => {
        const mod = TRAINING_MODULES[session.moduleId];
        return (
          <section key={session.sessionId} aria-labelledby={`cs-${session.sessionId}`}>
            <h3 id={`cs-${session.sessionId}`} className="text-base font-semibold">
              {session.label}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
              {mod?.title ?? session.moduleId} · added {formatWhen(session.addedAtMs, timezone)}
              {session.revokedAtMs ? ` · access removed ${formatWhen(session.revokedAtMs, timezone)}` : ''}
            </p>

            <div className="mt-3 flex flex-col gap-4">
              {session.parts.map((p) => {
                const def = getPart(session.moduleId, p.partId);
                if (!def) return null;
                const facts = attemptFacts(p, timezone);
                return (
                  <div key={p.partId} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{def.title}</h4>
                      <AdminStateBadge state={p.state} />
                    </div>
                    {facts && <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">{facts}</p>}
                    {p.startedAtMs && (
                      <div className="mt-3">
                        {watching === `${session.sessionId}/${p.partId}` ? (
                          <RecordingPlayer
                            sessionId={session.sessionId}
                            emailHash={emailHash}
                            partId={p.partId}
                            timezone={timezone}
                            partTitle={def.title}
                          />
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setWatching(`${session.sessionId}/${p.partId}`)}>
                            <MonitorPlay className="size-4" />
                            {p.state === 'in-progress' ? 'Watch live' : 'Screen recording'}
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="mt-3">
                      {p.slots.length > 0 ? (
                        <SubmissionSlots part={def} slots={p.slots} sources={p.sources} timezone={timezone} />
                      ) : (
                        <p className="text-sm text-zinc-400">Nothing submitted for this part.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
