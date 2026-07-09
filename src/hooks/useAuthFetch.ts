'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';

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
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }, [user]);
}
