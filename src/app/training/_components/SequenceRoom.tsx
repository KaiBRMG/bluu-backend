'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { MAX_ANSWER_LENGTH, type TestDef } from '@/lib/training/modules';
import type { SequenceResponse, TestResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api, ApiError } from '../_lib/api';
import { PANEL, FIELD } from '../_lib/theme';
import type { ScreenShare } from '../_lib/useScreenShare';
import { ScreenLock } from './ScreenLock';

interface SequenceRoomProps {
  initial: TestResponse;
  moduleId: string;
  test: TestDef;
  now: () => number;
  onEnded: (kind: 'time' | 'finished', filled: number) => void;
  share: ScreenShare;
  recordingFailing: boolean;
}

const WARN_MS = 10_000;
const DRAFT_SAVE_MS = 2000;

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
 */
export function SequenceRoom({ initial, moduleId, test, now, onEnded, share, recordingFailing }: SequenceRoomProps) {
  const attempt = initial.attempt!;
  const base = `/api/training/modules/${moduleId}/tests/${test.id}`;
  const [seq, setSeq] = useState<SequenceResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [holding, setHolding] = useState(false);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const draftRef = useRef('');
  const sentRef = useRef('');
  const indexRef = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const advancing = useRef(false);

  const screenLocked = attempt.recording && !share.stream;
  const end = useEffectEvent(() => onEnded('time', 0));
  // The clock ended (or the module was switched off): hand over from an effect, never from a callback.
  useEffect(() => {
    if (done) end();
  }, [done]);

  const saveDraft = useCallback(async (): Promise<void> => {
    const index = indexRef.current;
    if (index === null || draftRef.current === sentRef.current) return;
    const text = draftRef.current;
    try {
      await api(`${base}/answer`, { method: 'POST', body: { index, text } });
      if (indexRef.current === index) sentRef.current = text;
    } catch {
      /* the window's end retries once; a lost draft is the candidate's to retype, never a crash */
    }
  }, [base]);

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
        void (async () => {
          await saveDraft();
          await load();
          advancing.current = false;
        })();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [seq, now, saveDraft, load]);

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
            <div
              role="timer"
              aria-live="off"
              className={cn('text-[2.5rem] leading-none font-bold tabular-nums sm:text-5xl', warn ? 'text-amber-200' : 'text-white')}
            >
              {String(seconds).padStart(2, '0')}
            </div>
          </div>
        </header>
        <div className="sr-only" role="status" aria-live="polite">
          {holding ? 'Saved. Next image.' : seq ? `Image ${index + 1} of ${count}.` : ''}
        </div>

        {recordingFailing && share.stream && (
          <p role="alert" className={`${PANEL} mt-4 rounded-xl px-4 py-3 text-sm text-amber-200`}>
            Your screen recording is not reaching us. Check your connection.
          </p>
        )}

        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
          <div className={`${PANEL} grid min-h-64 flex-1 place-items-center overflow-hidden rounded-2xl`}>
            {holding || !seq?.imageUrl ? (
              <p className="text-base text-white/80" role="status">
                {error || (holding ? 'Saved — next image' : 'Loading the image…')}
              </p>
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
              id="sequence-answer"
              value={draft}
              disabled={holding || !seq || screenLocked}
              maxLength={MAX_ANSWER_LENGTH}
              rows={3}
              onChange={(e) => {
                setDraft(e.target.value);
                draftRef.current = e.target.value;
                if (saveTimer.current) window.clearTimeout(saveTimer.current);
                saveTimer.current = window.setTimeout(() => void saveDraft(), DRAFT_SAVE_MS);
              }}
              className={`${FIELD} mt-2 resize-none`}
            />
            <p className="mt-1.5 text-xs text-white/70">
              It is saved for you when the time for this image runs out. You cannot go back.
            </p>
          </div>
        </div>
      </div>
      {screenLocked && <ScreenLock share={share} deadlineMs={attempt.deadlineMs} now={now} />}
    </>
  );
}
