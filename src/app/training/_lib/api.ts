'use client';

import { useCallback, useRef } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Same-origin JSON call to the candidate API. The signed httpOnly cookie rides
 * along automatically, so there is no token to hold or leak in the page.
 */
export async function api<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
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
