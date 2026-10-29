'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_TEXT_LENGTH } from '@/lib/training/modules';
import { ApiError, api } from '../_lib/api';
import { FIELD } from '../_lib/theme';

interface TaskRecordProps {
  base: string;
  initial: string;
  /** Read-only once the room is shut. The last edit is still flushed. */
  locked: boolean;
  /** True while the latest text has not reached the server (typing, in flight, or failing). The room waits on it. */
  onPending: (pending: boolean) => void;
}

const DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;

/**
 * The task record: tools and models, prompts, attempts, spend, remaining
 * defects. Autosaved as the candidate types (the server accepts it until the
 * grace after the clock), so there is no Save button to forget — and the status
 * line says when it last landed, or that it has not.
 */
export function TaskRecord({ base, initial, locked, onPending }: TaskRecordProps) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  // From the first failed save until one lands — `status` passes through 'saving' on every retry.
  const [failed, setFailed] = useState(false);
  const sent = useRef(initial);
  const latest = useRef(initial);
  const inflight = useRef(false);
  const timer = useRef<number | null>(null);

  async function save() {
    if (inflight.current) return;
    // Typed and then deleted back to what the server holds: there is nothing to send, and nothing unsaved.
    if (latest.current === sent.current) {
      setStatus('saved');
      return;
    }
    inflight.current = true;
    const value = latest.current;
    setStatus('saving');
    try {
      await api(`${base}/text`, { method: 'PUT', body: { text: value } });
      sent.current = value;
      setSavedAt(Date.now());
      setError('');
      setFailed(false);
      setStatus(latest.current === value ? 'saved' : 'unsaved');
    } catch (err) {
      setStatus('error');
      setFailed(true);
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      // Try again shortly: a flaky line should not cost the candidate their notes.
      timer.current = window.setTimeout(() => void save(), RETRY_MS);
    } finally {
      inflight.current = false;
    }
    if (latest.current !== sent.current && !timer.current) void save();
  }

  function schedule(delay: number) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void save();
    }, delay);
  }

  useEffect(() => onPending(status !== 'saved'), [status, onPending]);

  // When the room locks, push whatever has not gone out yet.
  useEffect(() => {
    if (locked && latest.current !== sent.current) {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      void save();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section aria-labelledby="record-heading" className="mt-12">
      <h2 id="record-heading" className="text-xl font-semibold">
        Task record
      </h2>
      <p className="mt-1 text-sm text-white/70">
        The tools and models you used, prompts and settings, number of attempts, total spend, and any remaining defects. It
        saves as you type.
      </p>
      <textarea
        value={text}
        maxLength={MAX_TEXT_LENGTH}
        readOnly={locked}
        rows={10}
        aria-labelledby="record-heading"
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          setStatus('unsaved');
          schedule(DEBOUNCE_MS);
        }}
        onBlur={() => schedule(0)}
        className={`${FIELD} mt-3 min-h-52 resize-y leading-relaxed`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-white/70">
        {/* Typing is silent; a save that keeps failing is said once. */}
        <span className="sr-only" role="alert">
          {failed ? 'Your task record has not been saved yet. Trying again.' : ''}
        </span>
        <p>
          {status === 'error' ? (
            <span className="text-red-300">Not saved — {error} Trying again…</span>
          ) : status === 'saving' ? (
            'Saving…'
          ) : status === 'unsaved' ? (
            'Unsaved changes'
          ) : savedAt ? (
            `Saved at ${new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          ) : (
            ''
          )}
        </p>
        <p className="tabular-nums">
          {text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </p>
      </div>
    </section>
  );
}
