'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { LIVE_POLL_MS, useLiveRefresh } from '@/hooks/useTrainingAdmin';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPart } from '@/lib/training/modules';
import type { AdminSubmissionView } from '@/lib/training/types';
import RecordingPlayer from './RecordingPlayer';
import SubmissionSlots from './SubmissionSlots';
import { formatDuration, formatWhen } from './zonedTime';

interface SubmissionDialogProps {
  sessionId: string;
  target: { emailHash: string; partId: string; label: string } | null;
  moduleId: string;
  timezone: string;
  /** The part's clock is running (or its last uploads may still land): re-read the work as it comes in. */
  live: boolean;
  load: (emailHash: string, partId: string) => Promise<AdminSubmissionView>;
  onClose: () => void;
}


/**
 * One candidate's work on one part: their screen recording (live while the part
 * runs), then for each level the image they started from beside what they
 * handed in, with the upload time. Read-only — judgement happens outside the
 * app for now.
 *
 * The body is keyed by the target, so opening someone else's work remounts it
 * with a clean slate instead of resetting state from an effect. While the part
 * runs it re-reads on the live beat, and once more when it stops running, so
 * each edit appears as it is uploaded.
 */
export default function SubmissionDialog({ sessionId, target, moduleId, timezone, live, load, onClose }: SubmissionDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {target && (
          <SubmissionBody
            key={`${target.emailHash}:${target.partId}`}
            sessionId={sessionId}
            target={target}
            moduleId={moduleId}
            timezone={timezone}
            live={live}
            load={load}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionBody({
  sessionId,
  target,
  moduleId,
  timezone,
  live,
  load,
}: {
  sessionId: string;
  target: NonNullable<SubmissionDialogProps['target']>;
  moduleId: string;
  timezone: string;
  live: boolean;
  load: SubmissionDialogProps['load'];
}) {
  const [view, setView] = useState<AdminSubmissionView | null>(null);
  const [error, setError] = useState('');
  const [reads, setReads] = useState(0);
  useLiveRefresh(() => setReads((n) => n + 1), live ? LIVE_POLL_MS : null);

  // `live` is a dependency so the read after the clock stops picks up the last
  // uploads. A re-read never drops `view` back to null — that would unmount the
  // recording player mid-stream.
  useEffect(() => {
    let current = true;
    load(target.emailHash, target.partId)
      .then((v) => {
        if (!current) return;
        setView(v);
        setError('');
      })
      .catch((err) => current && setError(err instanceof Error ? err.message : 'Could not load the work'));
    return () => {
      current = false;
    };
  }, [target, load, live, reads]);

  const part = getPart(moduleId, target.partId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{target.label}</DialogTitle>
        <DialogDescription>
          {part?.title}
          {view?.startedAtMs ? ` · started ${formatWhen(view.startedAtMs, timezone)}` : ''}
          {view?.startedAtMs && view.finishedAtMs ? ` · finished early after ${formatDuration(view.finishedAtMs - view.startedAtMs)}` : ''}
        </DialogDescription>
      </DialogHeader>

      {error && !view ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : !view ? (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="activity-spinner size-5 animate-spin text-zinc-400" />
          <span className="sr-only">Loading</span>
        </div>
      ) : part ? (
        <div className="flex flex-col gap-6">
          <RecordingPlayer
            sessionId={sessionId}
            emailHash={target.emailHash}
            partId={target.partId}
            timezone={timezone}
            partTitle={part.title}
          />
          <SubmissionSlots part={part} slots={view.slots} sources={view.sources} timezone={timezone} />
        </div>
      ) : null}
    </>
  );
}
