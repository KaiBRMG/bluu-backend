import { IconBrandGoogleDrive } from '@tabler/icons-react';
import { DATASETS, type TestDef } from '@/lib/training/modules';
import type { AdminSubmissionView, MirrorState } from '@/lib/training/types';
import { formatSnipBytes } from '@/lib/snips';
import { formatWhen } from './zonedTime';

interface SubmissionSlotsProps {
  test: TestDef;
  submission: AdminSubmissionView;
  timezone: string;
}

const MIRROR: Record<MirrorState, { label: string; tone: string }> = {
  synced: { label: 'Synced to Drive', tone: 'text-green-300' },
  pending: { label: 'Drive copy pending', tone: 'text-zinc-300' },
  failed: { label: 'Drive copy failed', tone: 'text-red-300' },
};

/** The Drive state in words, never colour alone. */
export function MirrorMark({ state }: { state: MirrorState | null }) {
  if (!state) return null;
  const m = MIRROR[state];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${m.tone}`}>
      <IconBrandGoogleDrive className="size-3" aria-hidden />
      {m.label}
    </span>
  );
}

/**
 * One attempt's work, laid out for review: each final image beside the source it
 * started from, the working files, the task record and (T7) the answers. Shared
 * by every place that shows a submission, so two screens can never show the same
 * work differently.
 */
export default function SubmissionSlots({ test, submission, timezone }: SubmissionSlotsProps) {
  const bySlot = new Map(submission.slots.map((s) => [s.slotId, s]));
  return (
    <div className="flex flex-col gap-6">
      {test.slots.length > 0 && (
        <section aria-label="Final images">
          <h3 className="mb-2 text-sm font-medium">Final images</h3>
          <ul className="flex flex-col gap-3">
            {test.slots.map((def) => {
              const slot = bySlot.get(def.id);
              return (
                <li key={def.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-medium tabular-nums">
                      {def.stem}
                      {slot?.identity && !def.identity && ` · ${DATASETS[slot.identity].label}`}
                    </p>
                    <p className="text-[11px] text-zinc-400 tabular-nums">
                      {slot ? `Uploaded ${formatWhen(slot.uploadedAtMs, timezone)}` : 'Nothing uploaded'}
                    </p>
                  </div>
                  {slot && (
                    <>
                      <div className={slot.source ? 'grid grid-cols-2 gap-3' : ''}>
                        {slot.source && (
                          <figure>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slot.source.thumbUrl}
                              alt={`Source ${slot.source.name}`}
                              loading="lazy"
                              decoding="async"
                              className="aspect-square w-full rounded-lg object-cover"
                            />
                            <figcaption className="mt-1 text-[11px] text-zinc-400">Started from {slot.source.name}</figcaption>
                          </figure>
                        )}
                        <figure>
                          <a
                            href={slot.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slot.url}
                              alt={`Their ${def.stem}`}
                              loading="lazy"
                              decoding="async"
                              className="aspect-square w-full rounded-lg object-cover"
                            />
                          </a>
                          <figcaption className="mt-1 text-[11px] text-zinc-400 tabular-nums">
                            Their image · {formatSnipBytes(slot.bytes)} · opens full size
                          </figcaption>
                        </figure>
                      </div>
                      <div className="mt-2">
                        <MirrorMark state={slot.mirror} />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {submission.answers && (
        <section aria-label="Answers">
          <h3 className="mb-2 text-sm font-medium">Answers</h3>
          <ol className="flex flex-col gap-3">
            {submission.answers.map((a) => (
              <li key={a.index} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.imageUrl ? <img src={a.imageUrl} alt={`Image ${a.index + 1}`} loading="lazy" className="aspect-[3/4] w-full rounded-lg object-cover" /> : <span />}
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-400 tabular-nums">
                    Image {a.index + 1}
                    {a.atMs ? ` · answered ${formatWhen(a.atMs, timezone)}` : ''}
                  </p>
                  {a.text === null ? (
                    <p className="mt-1 text-sm text-zinc-400">No answer</p>
                  ) : (
                    <p className="mt-1 text-sm whitespace-pre-wrap">{a.text}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {test.kind !== 'sequence' && (
        <>
          <section aria-label="Working files">
            <h3 className="mb-2 text-sm font-medium">Working files</h3>
            {submission.workingFiles.length === 0 ? (
              <p className="text-sm text-zinc-400">None.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {submission.workingFiles.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-sm">
                    <a href={f.downloadUrl} className="min-w-0 flex-1 truncate font-medium outline-none hover:underline focus-visible:underline">
                      {f.name}
                    </a>
                    <span className="text-[11px] text-zinc-400 tabular-nums">{formatSnipBytes(f.bytes)}</span>
                    <MirrorMark state={f.mirror} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Task record">
            <h3 className="mb-2 text-sm font-medium">Task record</h3>
            {submission.text ? (
              <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm whitespace-pre-wrap">{submission.text}</p>
            ) : (
              <p className="text-sm text-zinc-400">Nothing written.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
