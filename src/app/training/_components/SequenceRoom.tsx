'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { IconArrowRight, IconCheck, IconLoader2 } from '@tabler/icons-react';
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
import { MAX_ANSWER_LENGTH, type TestDef } from '@/lib/training/modules';
import type { SequenceResponse, TestResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError, isRetryable } from '../_lib/api';
import { AZURE, AZURE_CHIP, AZURE_INK, DIALOG_PANEL, FIELD, PANEL, PROGRESS_AZURE } from '../_lib/theme';
import type { ScreenShare } from '../_lib/useScreenShare';
import { OFFLINE_TEXT, useOnline, useRoomGuards } from '../_lib/useRoomGuards';
import { Countdown } from './Countdown';
import { ScreenLock } from './ScreenLock';

interface SequenceRoomProps {
  initial: TestResponse;
  moduleId: string;
  test: TestDef;
  now: () => number;
  /** `unsaved`: an answer never reached the server. */
  onEnded: (kind: 'time' | 'finished', filled: number, unsaved?: boolean) => void;
  share: ScreenShare;
  recordingFailing: boolean;
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'stopped';

const DEBOUNCE_MS = 1200;
const RETRY_MS = 4000;
/** How long the room waits for answers still being saved before it hands over at the end. */
const FLUSH_WAIT_MS = 8000;

/**
 * T7 — Spot the Mistake. One clock for the whole test (`count × perImageMs`, like every other
 * test), and the images one at a time: Next shows the next one. Every image already shown stays
 * on the page in a column with its answer, so a candidate can go back and change one — the brief
 * recommends seeing them all first, as fast as they can, and only then going back.
 *
 * The server sends only the images shown so far (nothing past them is signed), and accepts an
 * answer for any of those until the clock ends. Each answer saves as it is typed; "Saved" is said
 * only when the server said so, and a save that keeps failing says that too.
 */
export function SequenceRoom({ initial, moduleId, test, now, onEnded, share, recordingFailing }: SequenceRoomProps) {
  const attempt = initial.attempt!;
  const seqDef = test.sequence!;
  const base = `/api/training/modules/${moduleId}/tests/${test.id}`;

  const [images, setImages] = useState<SequenceResponse['images']>([]);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Record<number, SaveState>>({});
  const [revealing, setRevealing] = useState(false);
  const [nextError, setNextError] = useState('');
  const [expired, setExpired] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // What each answer holds now, what the server last confirmed, and its pending timer — read from
  // timers and from the hand-over, which must see the latest values, not a render's.
  const latest = useRef(new Map<number, string>());
  const sent = useRef(new Map<number, string>());
  const timers = useRef(new Map<number, number>());
  const inflight = useRef(new Set<number>());
  const focusIndex = useRef<number | null>(null);

  useRoomGuards();
  const online = useOnline();
  const screenLocked = attempt.recording && !share.stream && !expired;
  const locked = expired || finishing || screenLocked;

  const apply = useCallback((res: SequenceResponse) => {
    setImages(res.images);
    setAnswers((prev) => {
      const next = { ...prev };
      for (const img of res.images) {
        if (!latest.current.has(img.index)) {
          latest.current.set(img.index, img.answer);
          sent.current.set(img.index, img.answer);
          next[img.index] = img.answer;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<SequenceResponse>(`${base}/sequence`)
      .then((res) => {
        if (cancelled) return;
        apply(res);
        setLoadError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Could not load the images.');
      });
    return () => {
      cancelled = true;
    };
  }, [base, apply, reloadKey]);

  const unsaved = () => [...latest.current].some(([i, text]) => sent.current.get(i) !== text);

  async function save(index: number) {
    timers.current.delete(index);
    if (inflight.current.has(index)) return;
    const text = latest.current.get(index) ?? '';
    if (sent.current.get(index) === text) {
      setStatus((s) => ({ ...s, [index]: 'saved' }));
      return;
    }
    inflight.current.add(index);
    setStatus((s) => ({ ...s, [index]: 'saving' }));
    try {
      await api(`${base}/answer`, { method: 'POST', body: { index, text } });
      sent.current.set(index, text);
      setStatus((s) => ({ ...s, [index]: latest.current.get(index) === text ? 'saved' : 'unsaved' }));
    } catch (err) {
      if (isRetryable(err) && !(err instanceof ApiError && err.status === 409)) {
        setStatus((s) => ({ ...s, [index]: 'error' }));
        timers.current.set(index, window.setTimeout(() => void save(index), RETRY_MS));
      } else {
        // Refused for good (time is up, training ended): sending it again would only repeat the refusal.
        setStatus((s) => ({ ...s, [index]: 'stopped' }));
      }
    } finally {
      inflight.current.delete(index);
    }
    if (latest.current.get(index) !== sent.current.get(index) && !timers.current.has(index) && !expired) {
      timers.current.set(index, window.setTimeout(() => void save(index), DEBOUNCE_MS));
    }
  }

  function schedule(index: number, delay: number) {
    const t = timers.current.get(index);
    if (t) window.clearTimeout(t);
    timers.current.set(index, window.setTimeout(() => void save(index), delay));
  }

  /** Sends every answer that has not reached the server, now, and waits a little for them to land. */
  async function flush() {
    for (const [i, t] of timers.current) {
      window.clearTimeout(t);
      timers.current.delete(i);
    }
    await Promise.all([...latest.current.keys()].map((i) => save(i)));
    for (let waited = 0; inflight.current.size > 0 && waited < FLUSH_WAIT_MS; waited += 200) {
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }

  const handOver = useEffectEvent(async (kind: 'time' | 'finished') => {
    await flush();
    onEnded(kind, 0, unsaved());
  });
  useEffect(() => {
    if (expired) void handOver('time');
  }, [expired]);

  useEffect(
    () => () => {
      for (const t of timers.current.values()) window.clearTimeout(t);
    },
    [],
  );

  async function next() {
    if (locked || revealing) return;
    setRevealing(true);
    setNextError('');
    try {
      const res = await api<SequenceResponse>(`${base}/sequence/next`, { method: 'POST' });
      focusIndex.current = res.images.length - 1;
      apply(res);
    } catch (err) {
      setNextError(err instanceof ApiError ? err.message : 'Could not show the next image. Try again.');
    } finally {
      setRevealing(false);
    }
  }

  // A newly shown image is scrolled to and its answer focused, so the candidate can type straight away.
  useEffect(() => {
    const i = focusIndex.current;
    if (i === null || i >= images.length) return;
    focusIndex.current = null;
    const card = document.getElementById(`t7-image-${i}`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    (document.getElementById(`t7-answer-${i}`) as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
  }, [images.length]);

  async function finishEarly() {
    setFinishing(true);
    setFinishError('');
    try {
      await flush();
      await api(`${base}/finish`, { method: 'POST' });
      onEnded('finished', 0, unsaved());
    } catch (err) {
      setFinishing(false);
      setConfirmFinish(false);
      setFinishError(err instanceof ApiError ? err.message : 'Could not finish. Try again.');
    }
  }

  const answered = images.filter((img) => (answers[img.index] ?? '').trim()).length;
  const allShown = images.length >= seqDef.count;
  const perImage = Math.round(seqDef.perImageMs / 1000);

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
                  Your screen recording is not reaching us. Check your connection.
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
                {answered} of {seqDef.count} answered
              </p>
              <Progress
                value={(answered / seqDef.count) * 100}
                aria-label="Images answered"
                className={cn('mt-2 h-1.5 bg-white/10', PROGRESS_AZURE)}
              />
              <p className="mt-2 hidden text-xs text-white/70 tabular-nums lg:block">
                {images.length} of {seqDef.count} shown
              </p>
              {attempt.recording && share.stream && (
                <p className="mt-1 flex items-center justify-end gap-2 text-xs text-white/70 lg:justify-start">
                  <span className="size-2 rounded-full bg-red-400" aria-hidden />
                  <span className="lg:hidden">Recording</span>
                  <span className="hidden lg:inline">Your screen is being recorded</span>
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => setConfirmFinish(true)}
              className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
            >
              Finish
            </Button>
          </div>
        </Countdown>

        <div className="min-w-0 py-6 lg:col-start-1 lg:row-start-1 lg:py-10">
          <h1 className="text-[2rem] leading-tight font-semibold text-balance sm:text-[2.5rem]">
            {test.id} · {test.title}
          </h1>
          <p className="mt-2 max-w-prose text-base text-white/80">
            Allow about {perImage} seconds per image, then press Next. See them all first, then come back to any answer you
            want to change.
          </p>

          {expired && (
            <p role="status" className={`${PANEL} mt-6 rounded-xl px-4 py-3 text-sm text-white`}>
              Time&apos;s up. Saving your last answers…
            </p>
          )}

          {loadError && images.length === 0 ? (
            <div role="alert" className="mt-8">
              <p className="text-base text-red-300">{loadError}</p>
              <Button variant="outline" className="mt-3 h-11" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </Button>
            </div>
          ) : images.length === 0 ? (
            <p className="mt-8 flex items-center gap-2 text-base text-white/80" role="status">
              <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
              Loading the first image…
            </p>
          ) : (
            <ol className="mt-8 flex flex-col gap-6" aria-label="Images">
              {images.map((img) => {
                const latestCard = img.index === images.length - 1;
                const hasAnswer = !!(answers[img.index] ?? '').trim();
                return (
                <li key={img.index} id={`t7-image-${img.index}`} className={`${PANEL} scroll-mt-44 rounded-2xl p-4 sm:p-5 lg:scroll-mt-24`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold tabular-nums">
                      Image {img.index + 1} of {seqDef.count}
                    </h2>
                    {/* The landmark for the go-back pass: which ones still need an answer. Words, not only a tint. */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                        hasAnswer ? AZURE_CHIP : 'border-white/[0.12] text-white/70',
                      )}
                    >
                      {hasAnswer && <IconCheck className="size-3" aria-hidden />}
                      {hasAnswer ? 'Answered' : 'No answer yet'}
                    </span>
                  </div>
                  <div className="mt-3 grid min-h-40 place-items-center overflow-hidden rounded-xl border border-white/[0.10] bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.imageUrl}
                      alt={`Image ${img.index + 1} of ${seqDef.count}`}
                      // The newest image is the one being studied; earlier ones are for checking an answer, so they
                      // take less height and going back stays a scan rather than a long scroll.
                      className={cn('w-auto max-w-full object-contain', latestCard ? 'max-h-[60dvh]' : 'max-h-72')}
                    />
                  </div>
                  <label htmlFor={`t7-answer-${img.index}`} className="mt-4 block text-sm font-medium text-white">
                    What is wrong with this image?
                  </label>
                  <textarea
                    id={`t7-answer-${img.index}`}
                    value={answers[img.index] ?? ''}
                    readOnly={locked}
                    maxLength={MAX_ANSWER_LENGTH}
                    rows={3}
                    aria-describedby={`t7-status-${img.index}`}
                    onChange={(e) => {
                      const text = e.target.value;
                      setAnswers((a) => ({ ...a, [img.index]: text }));
                      latest.current.set(img.index, text);
                      setStatus((s) => ({ ...s, [img.index]: 'unsaved' }));
                      schedule(img.index, DEBOUNCE_MS);
                    }}
                    onBlur={() => schedule(img.index, 0)}
                    onKeyDown={(e) => {
                      // Moving fast is the point: Ctrl/⌘+Enter on the newest answer goes to the next image.
                      if (latestCard && !allShown && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void next();
                      }
                    }}
                    className={`${FIELD} mt-2 resize-none`}
                  />
                  <AnswerStatus id={`t7-status-${img.index}`} state={status[img.index] ?? 'saved'} hasText={hasAnswer} />
                </li>
                );
              })}
            </ol>
          )}

          {images.length > 0 && (
            <div className="mt-6 flex flex-col items-start gap-3">
              {allShown ? (
                <p className={`${PANEL} rounded-xl px-4 py-3 text-base text-white/85`}>
                  All {seqDef.count} images shown. Use the time left to check your answers, or press Finish.
                </p>
              ) : (
                <Button
                  size="lg"
                  disabled={locked || revealing}
                  onClick={() => void next()}
                  className="h-12 px-6 text-base font-semibold"
                  style={{ backgroundColor: AZURE, color: AZURE_INK }}
                >
                  {revealing ? (
                    <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
                  ) : (
                    <IconArrowRight className="size-4" aria-hidden />
                  )}
                  Next image ({images.length + 1} of {seqDef.count})
                </Button>
              )}
              {!allShown && (
                <p className="hidden text-xs text-white/70 sm:block">
                  Or press <kbd className="rounded border border-white/20 px-1 font-sans">Ctrl</kbd>+<kbd className="rounded border border-white/20 px-1 font-sans">Enter</kbd> (or <kbd className="rounded border border-white/20 px-1 font-sans">⌘</kbd>+<kbd className="rounded border border-white/20 px-1 font-sans">Enter</kbd>) in your answer.
                </p>
              )}
              {nextError && (
                <p role="alert" className="text-sm text-red-300">
                  {nextError}
                </p>
              )}
            </div>
          )}
        </div>

        <AlertDialog open={confirmFinish && !screenLocked} onOpenChange={(open) => !finishing && setConfirmFinish(open)}>
          <AlertDialogContent className={cn('rounded-2xl', DIALOG_PANEL)}>
            <AlertDialogHeader>
              <AlertDialogTitle>Finish now?</AlertDialogTitle>
              <AlertDialogDescription className="text-white/75">
                You have answered {answered} of {seqDef.count} images
                {allShown ? '' : `, and ${seqDef.count - images.length} have not been shown yet`}. Once you finish you cannot
                change anything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                Keep going
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
      {screenLocked && <ScreenLock share={share} deadlineMs={attempt.deadlineMs} now={now} />}
    </>
  );
}

/** One answer's save state, in words. Quiet while it is fine; it only speaks up when something is wrong. */
function AnswerStatus({ id, state, hasText }: { id: string; state: SaveState; hasText: boolean }) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'unsaved'
        ? 'Unsaved changes'
        : state === 'error'
          ? 'Not saved yet — trying again.'
          : state === 'stopped'
            ? 'This change arrived after time was up, so it was not saved.'
            : hasText
              ? 'Saved'
              : '';
  return (
    <p id={id} className={cn('mt-1.5 min-h-4 text-xs', state === 'error' || state === 'stopped' ? 'text-red-300' : 'text-white/70')}>
      {state === 'error' || state === 'stopped' ? <span role="alert">{text}</span> : text}
    </p>
  );
}
