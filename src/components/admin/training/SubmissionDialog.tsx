'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPart } from '@/lib/training/modules';
import type { AdminSubmissionView } from '@/lib/training/types';
import { formatWhen } from './zonedTime';

interface SubmissionDialogProps {
  target: { emailHash: string; partId: string; label: string } | null;
  moduleId: string;
  timezone: string;
  load: (emailHash: string, partId: string) => Promise<AdminSubmissionView>;
  onClose: () => void;
}

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/**
 * One candidate's work on one part, laid out for comparison: for each level,
 * the image they started from beside what they handed in, with the upload
 * time. Read-only — judgement happens outside the app for now.
 *
 * The body is keyed by the target, so opening someone else's work remounts it
 * with a clean slate instead of resetting state from an effect.
 */
export default function SubmissionDialog({ target, moduleId, timezone, load, onClose }: SubmissionDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {target && (
          <SubmissionBody key={`${target.emailHash}:${target.partId}`} target={target} moduleId={moduleId} timezone={timezone} load={load} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionBody({
  target,
  moduleId,
  timezone,
  load,
}: {
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
  const sources = new Map((view?.sources ?? []).map((s) => [s.id, s]));
  const bySlot = new Map((view?.slots ?? []).map((s) => [s.slotId, s]));
  const letters = new Map([...new Set((view?.slots ?? []).map((s) => s.sourceId))].map((id, i) => [id, String.fromCharCode(65 + i)]));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{target.label}</DialogTitle>
        <DialogDescription>
          {part?.title}
          {view?.startedAtMs ? ` · started ${formatWhen(view.startedAtMs, timezone)}` : ''}
          {view?.startedAtMs && view.finishedAtMs ? ` · finished early after ${duration(view.finishedAtMs - view.startedAtMs)}` : ''}
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
      ) : (
        <ul className="flex flex-col gap-3">
          {part?.task.slots.map((def) => {
            const slot = bySlot.get(def.id);
            const src = slot ? sources.get(slot.sourceId) : undefined;
            return (
              <li key={def.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{def.label}</p>
                  <p className="text-[11px] text-zinc-400 tabular-nums">
                    {slot ? `Uploaded ${formatWhen(slot.uploadedAtMs, timezone)}` : 'Nothing uploaded'}
                  </p>
                </div>
                {slot ? (
                  <div className="grid grid-cols-2 gap-3">
                    <figure>
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src.thumbUrl} alt={`Source image ${letters.get(slot.sourceId)}`} className="aspect-square w-full rounded-lg object-cover" />
                      )}
                      <figcaption className="mt-1 text-[11px] text-zinc-400">Started from image {letters.get(slot.sourceId)}</figcaption>
                    </figure>
                    <figure>
                      <a href={slot.url} target="_blank" rel="noopener noreferrer" className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={slot.url} alt={`Their ${def.label} edit`} loading="lazy" decoding="async" className="aspect-square w-full rounded-lg object-cover" />
                      </a>
                      <figcaption className="mt-1 text-[11px] text-zinc-400 tabular-nums">
                        Their edit · {(slot.bytes / 1024 / 1024).toFixed(1)} MB · opens full size
                      </figcaption>
                    </figure>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
