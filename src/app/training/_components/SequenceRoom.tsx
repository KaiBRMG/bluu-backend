'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { MAX_ANSWER_LENGTH, type TestDef } from '@/lib/training/modules';
import type { SequenceResponse, TestResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError } from '../_lib/api';
import { PANEL, FIELD } from '../_lib/theme';
import type { ScreenShare } from '../_lib/useScreenShare';
import { useRoomGuards } from '../_lib/useRoomGuards';
import { useTabTitle } from '../_lib/useTabTitle';
import { ScreenLock } from './ScreenLock';

interface SequenceRoomProps {
  initial: TestResponse;
  moduleId: string;
  test: TestDef;
  now: () => number;
  /** `unsaved`: the last answer never reached the server. */
  onEnded: (kind: 'time' | 'finished', filled: number, unsaved?: boolean) => void;
  share: ScreenShare;
  recordingFailing: boolean;
}

const WARN_MS = 10_000;
const DRAFT_SAVE_MS = 2000;
const RETRY_MS = 4000;
const IMAGE_RETRIES = 4;

/** One painted frame after the image is decoded — or soon enough, in a tab that is not drawing frames. */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    const fallback = window.setTimeout(resolve, 400);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        resolve();
      }),
    );
  });

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
/** What happened to the answer on its way out of the window just closed. */
type Carried = 'pending' | 'saved' | 'failed';

/**
 * T7 — Spot the Mistake. Ten images, one at a time, thirty seconds each. The
 * server hands over ONLY the current image (signed until its window closes) and
 * accepts an answer only inside that window, so there is no going back and no
 * looking ahead; nothing is prefetched.
 *
 * It keeps a different clock from the other rooms. The focal number is the
 * 30-second window, and it neither pulses nor flashes: a flash in each window's
 * last seconds would make a five-minute test flash a third of the time. The last
 * ten seconds are carried by the `warn` border and the words "10 seconds", never
 * hue alone. The draft is auto-submitted at zero and the next image is fetched.
 *
 * The 30 seconds do not start when the image is fetched. The image is drawn, and only
 * when it has fully decoded and painted does the room tell the server so (`…/sequence/ready`);
 * the window runs from that ack. A slow line costs the candidate nothing. The server waits
 * for the ack only so long (`SEQUENCE_READY_CAP_MS`), then starts the window anyway, so an
 * image that never draws cannot stall the test. Until then the numeral waits at 30 and the
 * field is read-only.
 *
 * "Saved" is only said when the server said so: a failed save is retried at the
 * window's end, and if it still fails the hold line says the answer may not have
 * been saved instead of claiming it was. The textarea stays mounted (read-only
 * during the hold) and takes focus again with each new image, so a typist's
 * first words of the next window are not lost to a focus that fell to the page.
 */
export function SequenceRoom({ initial, moduleId, test, now, onEnded, share, recordingFailing }: SequenceRoomProps) {
  const attempt = initial.attempt!;
  const base = `/api/training/modules/${moduleId}/tests/${test.id}`;
  const [seq, setSeq] = useState<SequenceResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [holding, setHolding] = useState(false);
  const [carried, setCarried] = useState<Carried>('pending');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // True from the first failed save until one lands. `saveState` flips to 'saving' on every retry, so it cannot drive the announcement.
  const [saveFailed, setSaveFailed] = useState(false);
  const [left, setLeft] = useState(0);
  // Null until the window has started: the image has rendered and the server has acked it (or its cap passed).
  const [win, setWin] = useState<{ startsAt: number; endsAt: number } | null>(null);
  // The attempt's clock end moves out by the time the images took to arrive; the lock screen shows the live one.
  const [deadlineMs, setDeadlineMs] = useState(attempt.deadlineMs);
  const ackedRef = useRef<number | null>(null);
  const imageTries = useRef(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const draftRef = useRef('');
  const sentRef = useRef('');
  const indexRef = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const advancing = useRef(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  useRoomGuards();

  const screenLocked = attempt.recording && !share.stream;
  const end = useEffectEvent(() => onEnded('time', 0, draftRef.current !== sentRef.current));
  // The clock ended (or the module was switched off): hand over from an effect, never from a callback.
  useEffect(() => {
    if (done) end();
  }, [done]);

  /** True when the server has the current text (or there was nothing to send). */
  const saveDraft = useCallback(async (): Promise<boolean> => {
    const index = indexRef.current;
    if (index === null || draftRef.current === sentRef.current) return true;
    const text = draftRef.current;
    setSaveState('saving');
    try {
      await api(`${base}/answer`, { method: 'POST', body: { index, text } });
      if (indexRef.current === index) {
        sentRef.current = text;
        setSaveFailed(false);
        setSaveState(draftRef.current === text ? 'saved' : 'unsaved');
      }
      return true;
    } catch {
      if (indexRef.current === index) {
        setSaveFailed(true);
        setSaveState('error');
      }
      return false;
    }
  }, [base]);

  // A failing save is tried again while the window is still open.
  useEffect(() => {
    if (saveState !== 'error') return;
    const id = window.setInterval(() => void saveDraft(), RETRY_MS);
    return () => window.clearInterval(id);
  }, [saveState, saveDraft]);

  const load = useCallback(async () => {
    for (let attemptNo = 0; attemptNo < 5; attemptNo++) {
      try {
        const res = await api<SequenceResponse>(`${base}/sequence`);
        if (res.deadlineMs) setDeadlineMs(res.deadlineMs);
        if (res.index === null) {
          setDone(true);
          return;
        }
        // The same image asked for again (it would not draw, or the clock was a hair early) is not a new
        // image: what the candidate has typed stays, and the retry budget keeps counting down.
        const sameImage = indexRef.current === res.index;
        indexRef.current = res.index;
        if (!sameImage) {
          ackedRef.current = null;
          imageTries.current = 0;
        }
        // The clock the windows run on is the server's. A window already started (a reload, or the
        // cap passing) resumes where it is; a new one waits for its image.
        if (res.windowStartsAtMs !== null && res.windowEndsAtMs !== null) {
          setWin({ startsAt: res.windowStartsAtMs, endsAt: res.windowEndsAtMs });
          setLeft(res.windowEndsAtMs - now());
        } else {
          setWin(null);
          setLeft(res.windowMs);
        }
        if (!sameImage) {
          draftRef.current = res.answer;
          sentRef.current = res.answer;
          setDraft(res.answer);
          setSaveFailed(false);
          setSaveState('saved');
        }
        setSeq(res);
        setHolding(false);
        setError('');
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setDone(true); // the clock ended (or the module was switched off)
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load the next image.');
        await new Promise((r) => window.setTimeout(r, 1000));
      }
    }
  }, [base, now]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // The image has drawn: say so, and the window starts from the server's answer.
  const ackImage = useCallback(
    async (img: HTMLImageElement, forIndex: number) => {
      if (ackedRef.current === forIndex) return;
      ackedRef.current = forIndex;
      await img.decode().catch(() => undefined);
      await nextPaint();
      if (indexRef.current !== forIndex) return;
      for (let tries = 0; tries < 3; tries++) {
        try {
          const res = await api<{ windowStartsAtMs: number; windowEndsAtMs: number; deadlineMs: number }>(`${base}/sequence/ready`, {
            method: 'POST',
            body: { index: forIndex },
          });
          if (indexRef.current !== forIndex) return;
          setDeadlineMs(res.deadlineMs);
          setWin({ startsAt: res.windowStartsAtMs, endsAt: res.windowEndsAtMs });
          setLeft(res.windowEndsAtMs - now());
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) return; // the clock ended
          await new Promise((r) => window.setTimeout(r, 500));
        }
      }
      // The ack never landed; the server starts the window at its cap, and the timer below follows.
    },
    [base, now],
  );

  // An image that will not draw is asked for again; the server's cap starts the window regardless.
  const imageFailed = useCallback(() => {
    if (imageTries.current >= IMAGE_RETRIES) return;
    imageTries.current += 1;
    window.setTimeout(() => void load(), 1500);
  }, [load]);

  // No ack by the server's cap: the window has started anyway, from the cap.
  useEffect(() => {
    if (!seq?.startsByMs || win) return;
    const startsBy = seq.startsByMs;
    const id = window.setTimeout(
      () => {
        setWin((cur) => cur ?? { startsAt: startsBy, endsAt: startsBy + seq.windowMs });
        setLeft(startsBy + seq.windowMs - now());
      },
      Math.max(0, startsBy - now()),
    );
    return () => window.clearTimeout(id);
  }, [seq, win, now]);

  // Tick against the server clock; at zero submit the draft and move on.
  useEffect(() => {
    if (!seq || !win) return;
    const endsAt = win.endsAt;
    const id = window.setInterval(() => {
      const remaining = endsAt - now();
      setLeft((prev) => (Math.ceil(prev / 1000) === Math.ceil(remaining / 1000) ? prev : remaining));
      if (remaining <= 0 && !advancing.current) {
        advancing.current = true;
        setHolding(true);
        setCarried('pending');
        void (async () => {
          let ok = await saveDraft();
          if (!ok) ok = await saveDraft();
          setCarried(ok ? 'saved' : 'failed');
          await load();
          advancing.current = false;
        })();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [seq, win, now, saveDraft, load]);

  // Every new image starts with the cursor in the answer: the candidate never has to click back into it.
  useEffect(() => {
    if (seq && !holding && !screenLocked) answerRef.current?.focus({ preventScroll: true });
  }, [seq, holding, screenLocked]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const seconds = Math.max(0, Math.ceil(left / 1000));
  const warn = !!win && left <= WARN_MS && left > 0;
  const index = seq?.index ?? 0;
  const count = seq?.count ?? test.sequence!.count;

  useTabTitle(
    screenLocked
      ? 'Share your screen · Bluu Rock Training'
      : seq
        ? `${win ? `${seconds}s` : 'Loading'} · Image ${index + 1} of ${count} · ${test.id}`
        : null,
  );

  const holdLine =
    carried === 'failed'
      ? 'Your last answer may not have been saved — next image'
      : carried === 'saved'
        ? 'Saved — next image'
        : 'Saving your answer…';

  return (
    <>
      <div inert={screenLocked} className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-10">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/80">{test.id} · {test.title}</p>
            <h1 className="mt-1 text-[2rem] leading-tight font-semibold tabular-nums sm:text-[2.5rem]">
              Image {index + 1} of {count}
            </h1>
          </div>
          <div
            className={cn(
              'rounded-2xl border bg-white/[0.025] px-5 py-3 text-right',
              warn ? 'border-2 border-amber-300/70' : 'border-white/[0.10]',
            )}
          >
            <p className="text-xs font-medium text-white/80">{warn ? '10 seconds' : win ? 'This image' : 'Starts when it shows'}</p>
            {/* The window is the focal number of this room (§11): it outranks the heading beside it. */}
            <div
              role="timer"
              aria-live="off"
              className={cn('text-6xl leading-none font-bold tabular-nums sm:text-7xl', warn ? 'text-amber-200' : 'text-white')}
            >
              {String(seconds).padStart(2, '0')}
            </div>
          </div>
        </header>
        {/* Typing is silent: only a save that is failing is worth interrupting for, and it is said once. */}
        <div className="sr-only" role="alert">
          {saveFailed ? 'Your answer has not been saved yet. Trying again.' : ''}
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {holding
            ? carried === 'failed'
              ? 'Your last answer may not have been saved. Next image.'
              : carried === 'saved'
                ? 'Saved. Next image.'
                : ''
            : seq
              ? `Image ${index + 1} of ${count}.`
              : ''}
        </div>

        {recordingFailing && share.stream && (
          <p role="alert" className={`${PANEL} mt-4 rounded-xl px-4 py-3 text-sm text-amber-200`}>
            Your screen recording is not reaching us. Check your connection.
          </p>
        )}

        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
          <div className={`${PANEL} grid min-h-64 flex-1 place-items-center overflow-hidden rounded-2xl`}>
            {holding || !seq?.imageUrl ? (
              <p className="text-base text-white/80">{error || (holding ? holdLine : 'Loading the image…')}</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={seq.index}
                src={seq.imageUrl}
                onLoad={(e) => void ackImage(e.currentTarget, seq.index!)}
                onError={imageFailed}
                alt={`Image ${index + 1} of ${count}`}
                className="max-h-[60dvh] w-auto max-w-full object-contain"
              />
            )}
          </div>

          <div>
            <label htmlFor="sequence-answer" className="text-sm font-medium text-white">
              What is wrong with this image?
            </label>
            <textarea
              ref={answerRef}
              id="sequence-answer"
              value={draft}
              readOnly={holding || !win}
              disabled={!seq || screenLocked}
              maxLength={MAX_ANSWER_LENGTH}
              rows={3}
              aria-describedby="sequence-answer-status"
              onChange={(e) => {
                setDraft(e.target.value);
                draftRef.current = e.target.value;
                setSaveState('unsaved');
                if (saveTimer.current) window.clearTimeout(saveTimer.current);
                saveTimer.current = window.setTimeout(() => void saveDraft(), DRAFT_SAVE_MS);
              }}
              className={`${FIELD} mt-2 resize-none`}
            />
            <p
              id="sequence-answer-status"
              className={cn('mt-1.5 text-xs', saveState === 'error' ? 'text-red-300' : 'text-white/70')}
            >
              {saveState === 'error'
                ? 'Not saved yet — trying again. It is sent again when the time for this image runs out.'
                : saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'unsaved'
                    ? 'Unsaved changes'
                    : 'Saved as you type, and sent when the time for this image runs out. You cannot go back.'}
            </p>
          </div>
        </div>
      </div>
      {screenLocked && <ScreenLock share={share} deadlineMs={deadlineMs} now={now} />}
    </>
  );
}
