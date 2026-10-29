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
        // The clock the windows run on is the server's.
        setLeft(res.windowEndsAtMs ? res.windowEndsAtMs - now() : 0);
        if (res.index === null) {
          setDone(true);
          return;
        }
        indexRef.current = res.index;
        draftRef.current = res.answer;
        sentRef.current = res.answer;
        setDraft(res.answer);
        setSaveFailed(false);
        setSaveState('saved');
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

  // Tick against the server clock; at zero submit the draft and move on.
  useEffect(() => {
    if (!seq?.windowEndsAtMs) return;
    const endsAt = seq.windowEndsAtMs;
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
  }, [seq, now, saveDraft, load]);

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
  const warn = left <= WARN_MS && left > 0;
  const index = seq?.index ?? 0;
  const count = seq?.count ?? test.sequence!.count;

  useTabTitle(
    screenLocked
      ? 'Share your screen · Bluu Rock Training'
      : seq
        ? `${seconds}s · Image ${index + 1} of ${count} · ${test.id}`
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
            <p className="text-xs font-medium text-white/80">{warn ? '10 seconds' : 'This image'}</p>
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
              readOnly={holding}
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
      {screenLocked && <ScreenLock share={share} deadlineMs={attempt.deadlineMs} now={now} />}
    </>
  );
}
