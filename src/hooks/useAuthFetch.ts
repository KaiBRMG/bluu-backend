'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';

/**
 * The error thrown on a non-2xx response.
 *
 * Still an `Error` with the API's message, so every existing `err instanceof
 * Error ? err.message : …` call site is unaffected — it only *adds* the two
 * facts a caller sometimes has to branch on. A route that wants a client to
 * render a different screen rather than a Retry button returns a `code`, and
 * this is how that code survives the throw.
 */
export class ApiError extends Error {
  readonly status: number;
  /** The route's own machine-readable code, when it sent one. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Shared authenticated fetch helper: attaches the caller's Firebase ID token,
 * JSON-encodes, and throws the API's error message on non-2xx responses.
 * Extracted from the useDisputesData pattern for reuse across SMM hooks.
 */
export function useAuthFetch() {
  const { user } = useAuth();

  return useCallback(async (url: string, options: RequestInit = {}) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(
        data.error || `Request failed: ${res.status}`,
        res.status,
        typeof data.code === 'string' ? data.code : undefined,
      );
    }
    return res.json();
  }, [user]);
}
