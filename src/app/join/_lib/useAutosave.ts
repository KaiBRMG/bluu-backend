'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Answers } from '@/lib/creatorOnboarding';
import type { OnboardingCursor } from '@/types/creatorOnboarding';

/**
 * Autosave for the onboarding form. The contract is "an answer, once typed, is
 * not lost" — to a closed tab, a dropped connection, a crash or a reload.
 *
 * THREE LAYERS, each covering what the one before cannot:
 *
 * 1. **Server autosave.** Every change is queued and flushed ~700ms after the
 *    last keystroke as a PATCH of just the changed keys. The server merges on
 *    `answers.<id>` field paths, so a save can never erase a field it did not
 *    mention. This is the durable copy, and it is what makes the link resume on
 *    any device.
 *
 * 2. **A local pending buffer.** Until the server acknowledges a key, its value
 *    also sits in `localStorage`. If the tab dies offline, the next visit on
 *    this device folds the buffer back over the server's answers and re-sends
 *    it. Only UNACKNOWLEDGED keys are ever held, and each is cleared the moment
 *    the server has it — this is a delivery queue, not a second copy of the
 *    form. (The application form keeps nothing on disk because it has no
 *    server-side draft at all; here the server is the draft, so the local copy
 *    is bounded to the gap between typing and acknowledgement.)
 *
 * 3. **`pagehide` / hidden flush.** Leaving the page sends whatever is pending
 *    with `keepalive: true`, which the browser completes after the page is gone.
 *
 * A failed flush retries with backoff, and immediately on `online`. A 409 means
 * the form was already submitted (another tab); a 404 means the link was
 * rotated. Both stop saving and say so.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'locked' | 'invalid';

const FLUSH_DELAY_MS = 700;
const BACKOFF_MS = [2000, 5000, 10000, 20000, 30000];

function storageKey(token: string) {
  // The id half of the token only — the secret never goes to storage.
  return `bluu_join_pending_${token.slice(0, 32)}`;
}

function readPending(token: string): Answers {
  try {
    const raw = window.localStorage.getItem(storageKey(token));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Answers = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writePending(token: string, pending: Answers) {
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(storageKey(token));
    else window.localStorage.setItem(storageKey(token), JSON.stringify(pending));
  } catch {
    // Private mode / quota: the server layer still has everything it acknowledged.
  }
}

export function clearPending(token: string) {
  try {
    window.localStorage.removeItem(storageKey(token));
  } catch {
    /* nothing to clear */
  }
}

export function useAutosave(token: string, initialAnswers: Answers, initialCursor: OnboardingCursor | null) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [state, setState] = useState<SaveState>('idle');

  const pending = useRef<Answers>({});
  const cursor = useRef<OnboardingCursor | null>(initialCursor);
  const cursorDirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const attempt = useRef(0);
  const stopped = useRef(false);

  const endpoint = `/api/join/${token}`;

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (stopped.current || inFlight.current) return;
    const snapshot = { ...pending.current };
    if (Object.keys(snapshot).length === 0 && !cursorDirty.current) return;

    inFlight.current = true;
    cursorDirty.current = false;
    setState('saving');
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: snapshot, cursor: cursor.current }),
      });
      if (res.status === 409) {
        stopped.current = true;
        setState('locked');
        return;
      }
      if (res.status === 404) {
        stopped.current = true;
        setState('invalid');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));

      // Acknowledge only what was sent AND is unchanged since — a key edited
      // mid-flight stays pending and goes out on the next flush.
      for (const [k, v] of Object.entries(snapshot)) {
        if (pending.current[k] === v) delete pending.current[k];
      }
      writePending(token, pending.current);
      attempt.current = 0;
      setState(Object.keys(pending.current).length > 0 ? 'saving' : 'saved');
    } catch {
      cursorDirty.current = true;
      const delay = BACKOFF_MS[Math.min(attempt.current, BACKOFF_MS.length - 1)];
      attempt.current += 1;
      setState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      timer.current = window.setTimeout(() => void flush(), delay);
    } finally {
      inFlight.current = false;
    }
    // Anything that arrived while this request was out.
    if (!stopped.current && Object.keys(pending.current).length > 0 && !timer.current) {
      timer.current = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
    }
  }, [endpoint, token]);

  const schedule = useCallback(() => {
    if (stopped.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }, [flush]);

  const setAnswer = useCallback(
    (key: string, value: string) => {
      setAnswers((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
      pending.current[key] = value;
      writePending(token, pending.current);
      schedule();
    },
    [schedule, token],
  );

  const setCursor = useCallback(
    (next: OnboardingCursor) => {
      if (cursor.current?.chapter === next.chapter && cursor.current?.screen === next.screen) return;
      cursor.current = next;
      cursorDirty.current = true;
      schedule();
    },
    [schedule],
  );

  // Recover anything a previous visit on this device typed but never delivered.
  useEffect(() => {
    const recovered = readPending(token);
    if (Object.keys(recovered).length === 0) return;
    pending.current = { ...recovered, ...pending.current };
    setAnswers((prev) => ({ ...prev, ...recovered }));
    void flush();
  }, [token, flush]);

  // Leaving the page: hand the browser whatever is still pending.
  useEffect(() => {
    // Closing a tab fires `visibilitychange` (hidden) AND `pagehide`; both land
    // here. The last body sent is remembered so the second event — and the
    // debounce timer, which is cancelled — do not send the same snapshot again.
    let lastSent = '';
    const send = () => {
      if (stopped.current) return;
      const snapshot = pending.current;
      if (Object.keys(snapshot).length === 0 && !cursorDirty.current) return;
      const body = JSON.stringify({ answers: snapshot, cursor: cursor.current });
      if (body === lastSent) return;
      lastSent = body;
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      try {
        void fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      } catch {
        /* the local buffer still holds it */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') send();
      // Back on the page: the keepalive was fire-and-forget, so confirm it with
      // a normal flush — that is what acknowledges and clears the buffer.
      else if (Object.keys(pending.current).length > 0) void flush();
    };
    const onOnline = () => {
      attempt.current = 0;
      void flush();
    };
    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('pagehide', send);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [endpoint, flush]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  /** Everything not yet acknowledged — sent along with the final submit. */
  const pendingSnapshot = useCallback(() => ({ ...pending.current }), []);

  const markSubmitted = useCallback(() => {
    stopped.current = true;
    pending.current = {};
    clearPending(token);
    if (timer.current) window.clearTimeout(timer.current);
  }, [token]);

  return { answers, setAnswer, setCursor, state, flush, pendingSnapshot, markSubmitted };
}
