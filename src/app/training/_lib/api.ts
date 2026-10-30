'use client';

import { useCallback, useRef } from 'react';

/**
 * Fired when any call is answered `410 Gone`. The server uses 410 for two things — the module was
 * switched off, or the team ended this candidate's test (`code: 'attempt-ended'`) — so every part of a room (uploads, the task record, the recorder)
 * reports it the same way and the page can lock with one message instead of each showing a
 * refused request.
 */
export const TRAINING_STOPPED = 'training:stopped';

/** Why it stopped: `attempt-ended` when the team ended this one test for the candidate, else null (module off). */
export interface StoppedDetail {
  code: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Whether sending the same request again could succeed: the line dropped (0), the server was busy
 * or failed (408, 425, 429, 5xx), or a conflict that clears by itself (409 — e.g. the recording
 * catching up). A refusal about the request itself — invalid (400), not signed in (401), not
 * allowed (403), gone (404, 410), too large (413) — will be refused again, so it is not retried.
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  const s = err.status;
  return s === 0 || s === 408 || s === 409 || s === 425 || s === 429 || s >= 500;
}

/**
 * Same-origin JSON call to the candidate API. The signed httpOnly cookie rides
 * along automatically, so there is no token to hold or leak in the page.
 */
export async function api<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('You look to be offline. Check your connection and try again.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body keeps the generic message below */
  }
  if (res.status === 410) {
    // `attempt-ended`: the team ended this one test; anything else: the module was switched off.
    const code = (data as { code?: string } | null)?.code ?? null;
    window.dispatchEvent(new CustomEvent<StoppedDetail>(TRAINING_STOPPED, { detail: { code } }));
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new ApiError(message || 'Something went wrong. Please try again.', res.status);
  }
  return data as T;
}

/**
 * Keeps the browser's idea of "now" aligned with the server's.
 *
 * The deadline is a server timestamp. A device whose clock is two minutes slow
 * would otherwise show two extra minutes it does not have. `sync` is fed the
 * `nowMs` every response carries; `now()` is then device time plus the offset.
 */
export function useServerClock() {
  const skew = useRef(0);
  const sync = useCallback((serverNowMs: number) => {
    skew.current = serverNowMs - Date.now();
  }, []);
  const now = useCallback(() => Date.now() + skew.current, []);
  return { sync, now };
}
