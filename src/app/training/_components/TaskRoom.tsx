'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { IconCheck, IconDownload, IconLoader2, IconUpload } from '@tabler/icons-react';
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
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  MAX_OUTPUT_BYTES,
  OUTPUT_ACCEPT,
  IMAGE_LABEL,
  IMAGE_TYPES,
  type SlotDef,
  type SlotId,
  type TrainingPartDef,
} from '@/lib/training/modules';
import type { PartResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError } from '../_lib/api';
import { AZURE, AZURE_INK, PANEL } from '../_lib/theme';
import { Countdown } from './Countdown';

interface SlotState {
  sourceId: string | null;
  previewUrl: string | null;
  bytes: number;
  uploaded: boolean;
  busy: boolean;
  error: string;
}

const EMPTY: SlotState = { sourceId: null, previewUrl: null, bytes: 0, uploaded: false, busy: false, error: '' };

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface TaskRoomProps {
  initial: PartResponse;
  part: TrainingPartDef;
  now: () => number;
  onEnded: (kind: 'time' | 'finished', filled: number) => void;
}

/**
 * The focus room: after Start there is no masthead, no navigation, only the
 * brief, the images to choose from, the four slots and the clock.
 *
 * The picked images are derived on the server from the slots, so this component
 * keeps the choice locally and the slots are the record. Every rule it enforces
 * (two images, two edits each, four distinct levels) is enforced again by
 * `finalizeUpload` — this just says so before the candidate loses an upload.
 *
 * At zero the inputs lock, but an upload already on its way is left to finish
 * (the server accepts it inside the grace) and only then does the room hand
 * over to the "Time's up" screen.
 */
export function TaskRoom({ initial, part, now, onEnded }: TaskRoomProps) {
  const { task } = part;
  const sources = initial.sources ?? [];
  const attempt = initial.attempt!;
  const base = `/api/training/sessions/${initial.session.id}/parts/${part.id}`;

  const [slots, setSlots] = useState<Record<SlotId, SlotState>>(() => {
    const out = {} as Record<SlotId, SlotState>;
    for (const def of task.slots) {
      const stored = attempt.slots.find((s) => s.slotId === def.id);
      out[def.id] = stored
        ? { ...EMPTY, sourceId: stored.sourceId, previewUrl: stored.url, bytes: stored.bytes, uploaded: true }
        : { ...EMPTY };
    }
    return out;
  });
  const [picked, setPicked] = useState<string[]>(() => [
    ...new Set(attempt.slots.map((s) => s.sourceId)),
  ]);
  const [expired, setExpired] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');

  const filled = task.slots.filter((s) => slots[s.id].uploaded).length;
  const busyCount = task.slots.filter((s) => slots[s.id].busy).length;
  const locked = expired || finishing;

  const patch = useCallback((id: SlotId, next: Partial<SlotState>) => {
    setSlots((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  // Hand over once the clock is out AND nothing is still travelling. A hard cap
  // covers the server's grace so a stuck upload can never hold the room open.
  const handOver = useEffectEvent(() => onEnded('time', filled));
  useEffect(() => {
    if (!expired || busyCount > 0) return;
    const id = window.setTimeout(handOver, 500);
    return () => window.clearTimeout(id);
  }, [expired, busyCount]);
  useEffect(() => {
    if (!expired) return;
    const id = window.setTimeout(handOver, 45_000);
    return () => window.clearTimeout(id);
  }, [expired]);

  const usedBy = (sourceId: string, exceptSlot?: SlotId) =>
    task.slots.filter((s) => s.id !== exceptSlot && slots[s.id].sourceId === sourceId && (slots[s.id].uploaded || slots[s.id].busy))
      .length;

  function togglePick(id: string) {
    if (locked) return;
    if (picked.includes(id)) {
      if (usedBy(id) > 0) return; // it already has edits attached
      setPicked((p) => p.filter((x) => x !== id));
    } else if (picked.length < task.pickCount) {
      setPicked((p) => [...p, id]);
    }
  }

  async function upload(def: SlotDef, file: File) {
    const current = slots[def.id];
    if (locked || !current.sourceId) return;
    if (!(file.type in IMAGE_TYPES)) {
      patch(def.id, { error: `Upload a ${IMAGE_LABEL} image.` });
      return;
    }
    if (file.size > MAX_OUTPUT_BYTES) {
      patch(def.id, { error: `That file is ${mb(file.size)}. The limit is ${mb(MAX_OUTPUT_BYTES)}.` });
      return;
    }

    patch(def.id, { busy: true, error: '' });
    try {
      const { uploadId, uploadUrl } = await api<{ uploadId: string; uploadUrl: string }>(`${base}/upload-url`, {
        method: 'POST',
        body: { slotId: def.id, sourceId: current.sourceId, contentType: file.type, size: file.size },
      });
      let put: Response;
      try {
        put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      } catch {
        throw new ApiError('The upload did not go through. Check your connection and try again.', 0);
      }
      if (!put.ok) throw new ApiError('The upload did not go through. Try again.', put.status);
      await api(`${base}/finalize`, { method: 'POST', body: { uploadId } });

      const previous = slots[def.id].previewUrl;
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
      patch(def.id, { busy: false, uploaded: true, previewUrl: URL.createObjectURL(file), bytes: file.size, error: '' });
    } catch (err) {
      patch(def.id, {
        busy: false,
        error: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
      });
    }
  }

  async function finishEarly() {
    setFinishing(true);
    setFinishError('');
    try {
      await api(`${base}/finish`, { method: 'POST' });
      onEnded('finished', filled);
    } catch (err) {
      setFinishing(false);
      setConfirmFinish(false);
      setFinishError(err instanceof ApiError ? err.message : 'Could not finish. Try again.');
    }
  }

  const letter = (id: string) => String.fromCharCode(65 + picked.indexOf(id));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-14">
      <Countdown
        deadlineMs={attempt.deadlineMs}
        durationMs={part.durationMs}
        now={now}
        onExpire={() => setExpired(true)}
        className="lg:col-start-2 lg:row-start-1 lg:self-start"
      >
        <div className="flex items-center gap-3 lg:flex-col lg:items-stretch lg:gap-4">
          <div className="text-right lg:text-left">
            <p className="text-sm font-medium tabular-nums">
              {filled} of {task.slots.length} uploaded
            </p>
            <Progress
              value={(filled / task.slots.length) * 100}
              aria-label="Uploads"
              className="mt-2 hidden h-1.5 bg-white/10 lg:block [&>div]:bg-[#00b8f5]"
            />
          </div>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => setConfirmFinish(true)}
            className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
          >
            Finish early
          </Button>
        </div>
      </Countdown>

      <div className="min-w-0 py-6 lg:col-start-1 lg:row-start-1 lg:py-10">
        <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">{part.title}</h1>
        <div className="mt-3 flex max-w-prose flex-col gap-2 text-base leading-relaxed text-white/80">
          {part.brief.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>

        {expired && (
          <p role="status" className={`${PANEL} mt-6 rounded-xl px-4 py-3 text-sm text-white`}>
            {busyCount > 0 ? "Time's up. Finishing the uploads still on their way…" : "Time's up."}
          </p>
        )}
        {finishError && (
          <p role="alert" className="mt-6 text-sm text-red-300">
            {finishError}
          </p>
        )}

        <section aria-labelledby="pick-heading" className="mt-10">
          <h2 id="pick-heading" className="text-xl font-semibold">
            Choose {task.pickCount} images
          </h2>
          <p className="mt-1 text-sm text-white/70">
            Download the originals to work from. {picked.length} of {task.pickCount} chosen.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {sources.map((src) => {
              const on = picked.includes(src.id);
              const full = !on && picked.length >= task.pickCount;
              return (
                <li key={src.id} className="relative">
                  <button
                    type="button"
                    onClick={() => togglePick(src.id)}
                    aria-pressed={on}
                    disabled={locked || full}
                    className={cn(
                      'group block w-full overflow-hidden rounded-xl border text-left transition-colors outline-none',
                      'focus-visible:ring-2 focus-visible:ring-[#00b8f5]/70 disabled:cursor-not-allowed',
                      on ? 'border-[#00b8f5] bg-[#00b8f5]/10' : 'border-white/[0.10] bg-white/[0.03] enabled:hover:bg-white/[0.07]',
                      full && 'opacity-50',
                    )}
                  >
                    <span className="block aspect-square w-full overflow-hidden bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src.thumbUrl} alt={src.name} loading="lazy" decoding="async" className="size-full object-cover" />
                    </span>
                    <span className="flex min-h-11 items-center gap-2 px-3 py-2 text-xs text-white/80">
                      {on ? (
                        <>
                          <span
                            className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                            style={{ backgroundColor: AZURE, color: AZURE_INK }}
                          >
                            {letter(src.id)}
                          </span>
                          <span className="font-medium text-white">Image {letter(src.id)}</span>
                        </>
                      ) : (
                        <span className="truncate">{src.name}</span>
                      )}
                    </span>
                  </button>
                  <a
                    href={src.downloadUrl}
                    aria-label={`Download original of ${src.name}`}
                    className="absolute top-2 right-2 grid size-9 place-items-center rounded-lg border border-white/20 bg-[#08090b]/90 text-white outline-none hover:bg-black focus-visible:ring-2 focus-visible:ring-[#00b8f5]/70"
                  >
                    <IconDownload className="size-4" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="edits-heading" className="mt-12">
          <h2 id="edits-heading" className="text-xl font-semibold">
            Upload your {task.slots.length} edits
          </h2>
          <p className="mt-1 text-sm text-white/70">
            Each image gets {task.editsPerSource} edits. Every upload is saved the moment it finishes.
          </p>
          <ol className="mt-4 flex flex-col gap-3">
            {task.slots.map((def, index) => (
              <SlotCard
                key={def.id}
                def={def}
                index={index + 1}
                state={slots[def.id]}
                picked={picked}
                sources={sources}
                letter={letter}
                full={(sourceId) => usedBy(sourceId, def.id) >= task.editsPerSource}
                locked={locked}
                // Switching the source of an uploaded edit means a new upload is owed for it.
                onSource={(sourceId) => patch(def.id, { sourceId, error: '', uploaded: false })}
                onFile={(file) => void upload(def, file)}
              />
            ))}
          </ol>
        </section>
      </div>

      <AlertDialog open={confirmFinish} onOpenChange={(open) => !finishing && setConfirmFinish(open)}>
        <AlertDialogContent className="rounded-2xl border-white/10 bg-[#0d1014] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Finish now?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/75">
              You have uploaded {filled} of {task.slots.length}. Once you finish you cannot change anything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              Keep working
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={finishing}
              onClick={(e) => {
                e.preventDefault();
                void finishEarly();
              }}
              className="h-11 font-semibold"
              style={{ backgroundColor: AZURE, color: AZURE_INK }}
            >
              {finishing ? 'Finishing…' : 'Finish now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SlotCardProps {
  def: SlotDef;
  index: number;
  state: SlotState;
  picked: string[];
  sources: { id: string; name: string; thumbUrl: string }[];
  letter: (id: string) => string;
  full: (sourceId: string) => boolean;
  locked: boolean;
  onSource: (sourceId: string) => void;
  onFile: (file: File) => void;
}

function SlotCard({ def, index, state, picked, sources, letter, full, locked, onSource, onFile }: SlotCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const disabled = locked || state.busy || !state.sourceId;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const groupId = `slot-${def.id}-from`;

  return (
    <li className={`${PANEL} rounded-2xl p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            <span className="mr-2 tabular-nums text-white/60">{index}.</span>
            {def.label}
          </h3>
          <p className="mt-0.5 text-sm text-white/70">{def.hint}</p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
            state.uploaded ? 'border-[#00b8f5]/50 bg-[#00b8f5]/10 text-[#7dd8fa]' : 'border-white/[0.12] text-white/70',
          )}
        >
          {state.uploaded && <IconCheck className="size-3.5" aria-hidden />}
          {state.uploaded ? 'Uploaded' : 'Not uploaded'}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
          <p id={groupId} className="text-xs font-medium text-white/70">
            Made from
          </p>
          {picked.length === 0 ? (
            <p className="text-sm text-white/60">Choose your images above first.</p>
          ) : (
            <div className="flex gap-2">
              {picked.map((id) => {
                const src = byId.get(id);
                const selected = state.sourceId === id;
                const blocked = full(id) && !selected;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Image ${letter(id)}${blocked ? ' (already has its edits)' : ''}`}
                    disabled={locked || state.busy || blocked}
                    onClick={() => onSource(id)}
                    className={cn(
                      'flex h-11 min-w-11 items-center gap-2 rounded-xl border pr-3 pl-1.5 text-sm outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-[#00b8f5]/70 disabled:cursor-not-allowed disabled:opacity-45',
                      selected ? 'border-[#00b8f5] bg-[#00b8f5]/10 text-white' : 'border-white/[0.12] text-white/85 enabled:hover:bg-white/[0.07]',
                    )}
                  >
                    {src && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src.thumbUrl} alt="" className="size-8 rounded-md object-cover" />
                    )}
                    {selected && <IconCheck className="size-4 text-[#00b8f5]" aria-hidden />}
                    <span>{letter(id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept={OUTPUT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onFile(file);
            }}
          />
          <div
            onDragOver={(e) => {
              if (disabled) return;
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file && !disabled) onFile(file);
            }}
            className={cn(
              'flex min-h-20 items-center gap-4 rounded-xl border border-dashed p-3 transition-colors',
              over ? 'border-[#00b8f5] bg-[#00b8f5]/10' : 'border-white/20',
            )}
          >
            {state.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.previewUrl} alt={`Your upload for ${def.label}`} className="size-16 shrink-0 rounded-lg object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              {state.busy ? (
                <p className="flex items-center gap-2 text-sm text-white" role="status">
                  <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
                  Uploading…
                </p>
              ) : state.uploaded ? (
                <p className="text-sm text-white/80 tabular-nums">{mb(state.bytes)}</p>
              ) : (
                <p className="text-sm text-white/70">
                  {state.sourceId ? 'Drop an image here, or choose a file.' : 'Pick which image this was made from first.'}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="h-11 shrink-0 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
            >
              <IconUpload className="size-4" aria-hidden />
              {state.uploaded ? 'Replace' : 'Upload'}
            </Button>
          </div>
          {state.error && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {state.error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
