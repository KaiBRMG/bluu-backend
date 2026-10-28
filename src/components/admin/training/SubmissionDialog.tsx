'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
 * with a clean slate instead of resetting state from an effect.
 */
export default function SubmissionDialog({ sessionId, target, moduleId, timezone, load, onClose }: SubmissionDialogProps) {
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
  load,
}: {
  sessionId: string;
  target: NonNullable<SubmissionDialogProps['target']>;
  moduleId: string;
  timezone: string;
  load: SubmissionDialogProps['load'];
}) {
  const [view, setView] = useState<AdminSubmissionView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    load(target.emailHash, target.partId)
      .then((v) => live && setView(v))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not load the work'));
    return () => {
      live = false;
    };
  }, [target, load]);

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

      {error ? (
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
