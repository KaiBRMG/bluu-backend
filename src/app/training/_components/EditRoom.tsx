'use client';

import { memo, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { IconArrowDown, IconArrowRight, IconBook2, IconChevronRight, IconDownload, IconPhotoSearch } from '@tabler/icons-react';
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DATASETS,
  IMAGE_LABEL,
  IMAGE_TYPES,
  MAX_OUTPUT_BYTES,
  UPLOAD_GRACE_MS,
  WORKING_GRACE_MS,
  type BriefSection,
  type DatasetId,
  type SlotDef,
  type TestDef,
} from '@/lib/training/modules';
import type { SourceView, TestResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError, isRetryable } from '../_lib/api';
import { AZURE, AZURE_CHIP_BUTTON, AZURE_EDGE, AZURE_INK, AZURE_TEXT, DIALOG_PANEL, FOCUS, OVERLAY_BUTTON, PANEL, PROGRESS_AZURE } from '../_lib/theme';
import { fmtBytes, uploadFile } from '../_lib/upload';
import type { ScreenShare } from '../_lib/useScreenShare';
import { OFFLINE_TEXT, useOnline, useRoomGuards } from '../_lib/useRoomGuards';
import { BriefView, ExplainerView } from './Brief';
import { Countdown } from './Countdown';
import { DatasetModal } from './DatasetModal';
import { ScreenLock } from './ScreenLock';
import { EMPTY_SLOT, SlotUploader, type SlotState } from './SlotUploader';
import { TaskRecord } from './TaskRecord';
import { WorkingFiles } from './WorkingFiles';

interface EditRoomProps {
  initial: TestResponse;
  moduleId: string;
  test: TestDef;
  explainer: BriefSection[];
  now: () => number;
  /** `unsaved`: the task record never finished saving. */
  onEnded: (kind: 'time' | 'finished', filled: number, unsaved?: boolean) => void;
  /** The screen share the attempt is recorded from — owned by `ModuleView`, which runs the recorder. */
  share: ScreenShare;
  /** Segment uploads keep failing: the server will refuse uploads until they catch up. */
  recordingFailing: boolean;
}

/**
 * The focus room for T1–T6: after Start there is no masthead, no navigation —
 * only the brief, the images, the slots, the working files, the task record and
 * the clock (DESIGN.md §11).
 *
 * `edit` tests (T1–T5) show a row per source: the code, the source image, an
 * arrow, the slot it becomes. `generate` (T6) has no source to edit, so no
 * arrows: a grid of slots, with the supplied media in its own panel marked
 * viewing-only. Every rule here is enforced again on the server; the room just
 * says so before the candidate loses an upload.
 *
 * At zero the inputs lock, but anything already travelling is left to finish —
 * the server allows 30 s for a final image and 10 minutes for a working file —
 * and only then does the room hand over to "Time's up". A recorded attempt is
 * locked whenever the screen is not shared (`ScreenLock`); the clock keeps
 * running underneath.
 */
export function EditRoom({ initial, moduleId, test, explainer, now, onEnded, share, recordingFailing }: EditRoomProps) {
  const attempt = initial.attempt!;
  const sources = initial.sources ?? [];
  const base = `/api/training/modules/${moduleId}/tests/${test.id}`;

  const [slots, setSlots] = useState<Record<string, SlotState>>(() => {
    const out: Record<string, SlotState> = {};
    for (const def of test.slots) {
      const stored = attempt.slots.find((s) => s.slotId === def.id);
      out[def.id] = stored ? { ...EMPTY_SLOT, uploaded: true, previewUrl: stored.url, bytes: stored.bytes } : { ...EMPTY_SLOT };
    }
    return out;
  });
  const [choices, setChoices] = useState<Record<string, DatasetId>>(attempt.datasetChoices);
  const [identityError, setIdentityError] = useState('');
  const [briefOpen, setBriefOpen] = useState(true);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [datasets, setDatasets] = useState<{ open: boolean; at: DatasetId | null; n: number }>({ open: false, at: null, n: 0 });
  const [expired, setExpired] = useState(false);
  const [workBusy, setWorkBusy] = useState(0);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  // The task record is autosaved, so "nothing is travelling" has to include it: a note typed in the
  // last seconds is still on its way (or failing) when the clock reaches zero.
  const [recordPending, setRecordPending] = useState(false);
  const [recordGaveUp, setRecordGaveUp] = useState(false);
  const recordPendingRef = useRef(false);
  const onRecordPending = useCallback((pending: boolean) => {
    recordPendingRef.current = pending;
    setRecordPending(pending);
  }, []);

  useRoomGuards();
  const online = useOnline();
  // The file each slot last tried, so a failed upload can be sent again without finding it twice.
  const lastFile = useRef(new Map<string, File>());

  const filled = test.slots.filter((s) => slots[s.id].uploaded).length;
  const recordBusy = recordPending && !recordGaveUp;
  const busyCount = test.slots.filter((s) => slots[s.id].busy).length + workBusy + (recordBusy ? 1 : 0);
  const screenLocked = attempt.recording && !share.stream && !expired;
  const locked = expired || finishing || screenLocked;

  // A dialog does not wait out the lock: when the screen goes, the Finish prompt is dropped rather than held for the re-share.
  if (screenLocked && confirmFinish) setConfirmFinish(false);

  const patch = useCallback((id: string, next: Partial<SlotState>) => {
    setSlots((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  // Hand over once the clock is out AND nothing is still travelling. The cap covers the
  // server's grace — ten minutes when a working file is on its way — so a stuck upload
  // can never hold the room open.
  const handOver = useEffectEvent(() => onEnded('time', filled, recordPendingRef.current));
  useEffect(() => {
    if (!expired || busyCount > 0) return;
    const id = window.setTimeout(handOver, 500);
    return () => window.clearTimeout(id);
  }, [expired, busyCount]);
  useEffect(() => {
    if (!expired) return;
    const id = window.setTimeout(handOver, WORKING_GRACE_MS + 5_000);
    return () => window.clearTimeout(id);
  }, [expired]);
  // The server takes the task record only for the upload grace after the clock; past that, waiting on it is pointless.
  useEffect(() => {
    if (!expired) return;
    const id = window.setTimeout(() => setRecordGaveUp(true), UPLOAD_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [expired]);

  async function upload(def: SlotDef, file: File) {
    if (locked) return;
    if (!(file.type in IMAGE_TYPES)) {
      // Name what was wrong with THIS file: an iPhone's HEIC, a PDF, a file with no type at all.
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase().slice(0, 8) : '';
      patch(def.id, {
        error: `${ext ? `That is a ${ext} file. ` : 'That file type is not accepted. '}Upload a ${IMAGE_LABEL} image.`,
        retryable: false,
      });
      return;
    }
    if (file.size > MAX_OUTPUT_BYTES) {
      patch(def.id, { error: `That file is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_OUTPUT_BYTES)}.`, retryable: false });
      return;
    }
    lastFile.current.set(def.id, file);
    patch(def.id, { busy: true, progress: 0, error: '', retryable: false });
    let shown = 0;
    try {
      await uploadFile(base, { kind: 'final', slotId: def.id, contentType: file.type, size: file.size }, file, file.type, (p) => {
        // The XHR reports many times a second; the room only needs to move when the percentage does.
        const pct = Math.round(p * 100);
        if (pct !== shown) {
          shown = pct;
          patch(def.id, { progress: p });
        }
      });
      const previous = slots[def.id].previewUrl;
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
      lastFile.current.delete(def.id);
      patch(def.id, { busy: false, uploaded: true, previewUrl: URL.createObjectURL(file), bytes: file.size, error: '' });
    } catch (err) {
      patch(def.id, {
        busy: false,
        error: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
        retryable: isRetryable(err),
      });
    }
  }

  // The rows are memoised, and a progress tick is a state change in this component: the handlers they
  // receive must keep their identity, so a percentage moving on one slot does not redraw the others.
  const uploadRef = useRef(upload);
  useEffect(() => {
    uploadRef.current = upload;
  });
  const handleFile = useCallback((def: SlotDef, file: File) => void uploadRef.current(def, file), []);
  const handleRetry = useCallback((def: SlotDef) => {
    const file = lastFile.current.get(def.id);
    if (file) void uploadRef.current(def, file);
  }, []);

  const chooseIdentity = useCallback(
    async (slotId: string, identity: DatasetId) => {
      setIdentityError('');
      try {
        const res = await api<{ choices: Record<string, DatasetId> }>(`${base}/identity`, {
          method: 'POST',
          body: { slotId, identity },
        });
        setChoices(res.choices);
      } catch (err) {
        setIdentityError(err instanceof ApiError ? err.message : 'Could not change that. Try again.');
      }
    },
    [base],
  );

  async function finishEarly() {
    setFinishing(true);
    setFinishError('');
    try {
      // Finishing locks the task record, which pushes its last edit; give that a moment to land before the room goes.
      for (let waited = 0; recordPendingRef.current && waited < 8_000; waited += 200) await new Promise((r) => window.setTimeout(r, 200));
      await api(`${base}/finish`, { method: 'POST' });
      onEnded('finished', filled, recordPendingRef.current);
    } catch (err) {
      setFinishing(false);
      setConfirmFinish(false);
      setFinishError(err instanceof ApiError ? err.message : 'Could not finish. Try again.');
    }
  }

  const openDatasets = useCallback((at: DatasetId | null) => setDatasets((d) => ({ open: true, at, n: d.n + 1 })), []);
  const sourceFor = (slotId: string) => sources.find((s) => s.slotId === slotId);

  return (
    <>
      <div
        inert={screenLocked}
        className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-14"
      >
        <Countdown
          deadlineMs={attempt.deadlineMs}
          durationMs={test.durationMs}
          now={now}
          onExpire={() => setExpired(true)}
          title={`${test.id} ${test.title}`}
          screenLocked={screenLocked}
          alerts={
            <>
              {!online && !expired && (
                <p role="alert" className="text-amber-200">
                  {OFFLINE_TEXT}
                </p>
              )}
              {recordingFailing && share.stream && !expired && online && (
                <p role="alert" className="text-amber-200">
                  Your screen recording is not reaching us, so uploads wait until it catches up. Check your connection.
                </p>
              )}
              {finishError && (
                <p role="alert" className="text-red-300">
                  {finishError}
                </p>
              )}
            </>
          }
          className="lg:col-start-2 lg:row-start-1 lg:self-start"
        >
          <div className="flex items-center gap-3 lg:flex-col lg:items-stretch lg:gap-4">
            <div className="text-right lg:text-left">
              <p className="text-sm font-medium tabular-nums">
                {filled} of {test.slots.length} uploaded
              </p>
              <Progress
                value={(filled / test.slots.length) * 100}
                aria-label="Final images uploaded"
                className={cn('mt-2 h-1.5 bg-white/10', PROGRESS_AZURE)}
              />
              {attempt.recording && share.stream && (
                <p className="mt-2 flex items-center justify-end gap-2 text-xs text-white/70 lg:justify-start">
                  <span className="size-2 rounded-full bg-red-400" aria-hidden />
                  <span className="lg:hidden">Recording</span>
                  <span className="hidden lg:inline">Your screen is being recorded</span>
                </p>
              )}
            </div>
            <div className="hidden flex-col gap-2 lg:flex">
              {test.datasets.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => openDatasets(null)}
                  className="h-11 justify-start border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
                >
                  <IconPhotoSearch className="size-4" aria-hidden />
                  Datasets
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setExplainerOpen(true)}
                className="h-11 justify-start border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
              >
                <IconBook2 className="size-4" aria-hidden />
                Explainer
              </Button>
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
          <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">
            {test.id} · {test.title}
          </h1>

          {/* Below `lg` the rail is a pinned band with no room for these two. */}
          <div className="mt-3 flex flex-wrap gap-2 lg:hidden">
            {test.datasets.length > 0 && (
              <Button
                variant="outline"
                onClick={() => openDatasets(null)}
                className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
              >
                <IconPhotoSearch className="size-4" aria-hidden />
                Datasets
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setExplainerOpen(true)}
              className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
            >
              <IconBook2 className="size-4" aria-hidden />
              Explainer
            </Button>
          </div>

          {/* The brief reads first and folds once read — a state change, not one of the clock's two motions. */}
          {briefOpen ? (
            <section aria-label="Brief" className="mt-6">
              <BriefView test={test} compact level={2} />
              <button
                type="button"
                onClick={() => setBriefOpen(false)}
                aria-expanded={true}
                className={cn('mt-4 min-h-11 rounded text-sm underline-offset-4 hover:underline', AZURE_TEXT, FOCUS)}
              >
                Hide the brief
              </button>
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setBriefOpen(true)}
              aria-expanded={false}
              className={cn(PANEL, 'mt-6 flex min-h-11 w-full items-center gap-2 rounded-xl px-4 text-left text-sm', FOCUS)}
            >
              <IconChevronRight className="size-4 text-white/70" aria-hidden />
              <span className="text-white">Brief · {test.id} {test.title}</span>
              <span className="ml-auto text-white/60">Show</span>
            </button>
          )}

          {expired && (
            <p role="status" className={`${PANEL} mt-6 rounded-xl px-4 py-3 text-sm text-white`}>
              {busyCount > 0 ? "Time's up. Saving what is still arriving…" : "Time's up."}
            </p>
          )}

          <section aria-labelledby="finals-heading" className="mt-10">
            <h2 id="finals-heading" className="text-xl font-semibold">
              Final images
            </h2>
            <p className="mt-1 text-sm text-white/70">
              Every upload is saved the moment it finishes.
            </p>
            {identityError && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {identityError}
              </p>
            )}

            {test.kind === 'edit' ? (
              <ol className="mt-4 flex flex-col gap-4">
                {test.slots.map((def) => (
                  <EditRow
                    key={def.id}
                    def={def}
                    source={sourceFor(def.id)}
                    state={slots[def.id]}
                    choice={choices[def.id]}
                    choices={choices}
                    identities={test.datasets}
                    locked={locked}
                    onFile={handleFile}
                    onRetry={handleRetry}
                    onDataset={openDatasets}
                    onChoose={chooseIdentity}
                  />
                ))}
              </ol>
            ) : (
              <GenerateGrid test={test} slots={slots} locked={locked} onFile={handleFile} onRetry={handleRetry} />
            )}
          </section>

          {test.kind === 'generate' && <Inspiration sources={sources} />}

          <WorkingFiles base={base} initial={attempt.workingFiles} locked={expired || finishing || screenLocked} expired={expired} onBusy={setWorkBusy} />
          <TaskRecord base={base} initial={attempt.text} locked={expired || finishing} onPending={onRecordPending} />
        </div>

        <AlertDialog open={confirmFinish && !screenLocked} onOpenChange={(open) => !finishing && setConfirmFinish(open)}>
          <AlertDialogContent className={cn('rounded-2xl', DIALOG_PANEL)}>
            <AlertDialogHeader>
              <AlertDialogTitle>Finish now?</AlertDialogTitle>
              <AlertDialogDescription className="text-white/75">
                You have uploaded {filled} of {test.slots.length} final images. Once you finish you cannot change anything.
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

      {test.datasets.length > 0 && (
        <DatasetModal
          key={datasets.n}
          open={datasets.open && !screenLocked}
          onOpenChange={(open) => setDatasets((d) => ({ ...d, open }))}
          base={base}
          identities={test.datasets}
          initial={datasets.at}
        />
      )}
      <Sheet open={explainerOpen && !screenLocked} onOpenChange={setExplainerOpen}>
        <SheetContent side="right" className={cn('w-full overflow-y-auto p-5 sm:max-w-xl', DIALOG_PANEL)}>
          <SheetHeader className="p-0 pb-4">
            <SheetTitle className="text-xl text-white">Explainer</SheetTitle>
            <SheetDescription className="text-white/70">The rules that apply to every test.</SheetDescription>
          </SheetHeader>
          <ExplainerView sections={explainer} />
        </SheetContent>
      </Sheet>
      {screenLocked && <ScreenLock share={share} deadlineMs={attempt.deadlineMs} now={now} />}
    </>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

interface EditRowProps {
  def: SlotDef;
  source: SourceView | undefined;
  state: SlotState;
  choice: DatasetId | undefined;
  choices: Record<string, DatasetId>;
  identities: DatasetId[];
  locked: boolean;
  onFile: (def: SlotDef, file: File) => void;
  onRetry: (def: SlotDef) => void;
  onDataset: (at: DatasetId | null) => void;
  onChoose: (slotId: string, identity: DatasetId) => void;
}

/** One source → one final: the code, the source image, an arrow, the slot. Memoised: only the row whose slot moved redraws. */
const EditRow = memo(function EditRow({ def, source, state, choice, choices, identities, locked, onFile, onRetry, onDataset, onChoose }: EditRowProps) {
  const needsChoice = def.pickIdentity && !choice;
  return (
    <li className={`${PANEL} rounded-2xl p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-lg font-semibold tabular-nums">{def.code}</h3>
        {def.identity && (
          <button
            type="button"
            onClick={() => onDataset(def.identity!)}
            aria-label={`Open the ${DATASETS[def.identity].label} dataset`}
            className={cn('inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium', AZURE_CHIP_BUTTON, FOCUS)}
          >
            <IconPhotoSearch className="size-4" aria-hidden />
            {DATASETS[def.identity].label} dataset
          </button>
        )}
      </div>

      {def.correction && (
        <div className="mt-2 max-w-prose text-sm leading-relaxed text-white/80">
          <p className="font-medium text-white">{def.correction.title}</p>
          {def.correction.body.map((p) => (
            <p key={p} className="mt-1">
              {p}
            </p>
          ))}
        </div>
      )}

      {def.pickIdentity && (
        <IdentityPicker
          slot={def}
          identities={identities}
          choice={choice}
          choices={choices}
          disabled={locked || state.uploaded || state.busy}
          onChoose={(identity) => onChoose(def.id, identity)}
        />
      )}

      <div className="mt-4 grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <figure className="min-w-0">
          {source ? (
            <div className="relative overflow-hidden rounded-xl border border-white/[0.10] bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.thumbUrl}
                alt={`Source image ${def.code}`}
                width={source.width}
                height={source.height}
                decoding="async"
                className="mx-auto max-h-96 w-auto max-w-full object-contain"
              />
              <a
                href={source.downloadUrl}
                data-download
                aria-label={`Download the original of source ${def.code}`}
                className={cn(OVERLAY_BUTTON, FOCUS)}
              >
                <IconDownload className="size-4" aria-hidden />
              </a>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-white/20 p-6 text-sm text-white/70">Source image unavailable.</p>
          )}
          <figcaption className="mt-1.5 text-xs text-white/70">Source · {source?.name ?? def.code}</figcaption>
        </figure>
        <IconArrowRight className="mx-auto hidden size-6 text-white/50 md:block" aria-hidden />
        <IconArrowDown className="mx-auto size-6 text-white/50 md:hidden" aria-hidden />
        <SlotUploader
          stem={def.stem}
          state={state}
          disabled={locked}
          waitingFor={needsChoice ? 'Choose which identity this image uses first.' : undefined}
          onFile={(file) => onFile(def, file)}
          onRetry={() => onRetry(def)}
        />
      </div>
    </li>
  );
});

/**
 * T4: which identity this image uses. Each is used exactly once, so choosing one
 * already on another slot SWAPS the two — and says which slot has it. A slot with
 * an upload is locked: its identity is part of what was submitted.
 */
function IdentityPicker({
  slot,
  identities,
  choice,
  choices,
  disabled,
  onChoose,
}: {
  slot: SlotDef;
  identities: DatasetId[];
  choice: DatasetId | undefined;
  choices: Record<string, DatasetId>;
  disabled: boolean;
  onChoose: (identity: DatasetId) => void;
}) {
  const groupId = `identity-${slot.id}`;
  return (
    <div role="radiogroup" aria-labelledby={groupId} className="mt-3">
      <p id={groupId} className="text-xs font-medium text-white/70">
        Identity for this image
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {identities.map((id) => {
          const usedOn = Object.entries(choices).find(([s, v]) => v === id && s !== slot.id)?.[0];
          const selected = choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChoose(id)}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm transition-colors',
                FOCUS,
                'disabled:cursor-not-allowed disabled:opacity-60',
                selected ? `${AZURE_EDGE} text-white` : 'border-white/[0.12] text-white/85 enabled:hover:bg-white/[0.07]',
              )}
            >
              {DATASETS[id].label}
              {usedOn && !selected && <span className="text-xs text-white/60">Used on {usedOn}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** T6: no source to edit, so no arrows — identities across, the three tiers down. */
function GenerateGrid({
  test,
  slots,
  locked,
  onFile,
  onRetry,
}: {
  test: TestDef;
  slots: Record<string, SlotState>;
  locked: boolean;
  onFile: (def: SlotDef, file: File) => void;
  onRetry: (def: SlotDef) => void;
}) {
  const identities = [...new Set(test.slots.map((s) => s.identity!))];
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {identities.map((id) => (
        <section key={id} aria-labelledby={`gen-${id}`} className={`${PANEL} rounded-2xl p-4 sm:p-5`}>
          <h3 id={`gen-${id}`} className="text-lg font-semibold">
            {DATASETS[id].label}
          </h3>
          <div className="mt-3 flex flex-col gap-4">
            {test.slots
              .filter((s) => s.identity === id)
              .map((def) => (
                <SlotUploader key={def.id} compact stem={def.stem} state={slots[def.id]} disabled={locked} onFile={(f) => onFile(def, f)} onRetry={() => onRetry(def)} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** T6: the supplied media. Viewing only — there is deliberately no download. */
function Inspiration({ sources }: { sources: SourceView[] }) {
  const groups = [...new Set(sources.map((s) => s.group ?? ''))];
  return (
    <section aria-labelledby="inspiration-heading" className="mt-12">
      <h2 id="inspiration-heading" className="text-xl font-semibold">
        Inspiration — viewing only
      </h2>
      <p className="mt-1 max-w-prose text-sm text-white/75">
        Do not edit these or use them as input, and do not recreate their compositions.
      </p>
      {groups.map((g) => (
        <div key={g} className="mt-4">
          {g && <h3 className="text-sm font-semibold text-white/90">{g}</h3>}
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {sources
              .filter((s) => (s.group ?? '') === g)
              .map((s, n) => (
                <li key={s.id} className="overflow-hidden rounded-lg border border-white/[0.10] bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.thumbUrl}
                    alt={`${g ? `${g}, ` : ''}inspiration image ${n + 1}, viewing only`}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[3/4] w-full object-cover"
                  />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
