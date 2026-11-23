'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { ShiftSpan } from '@/lib/shiftSpans';

interface UseMyShiftReturn {
  /** Merged spans around now (±1 day); empty when the caller has no shift. */
  shifts: ShiftSpan[];
  loading: boolean;
}

/**
 * The signed-in person's own scheduled shift spans, from
 * `GET /api/time-tracking/my-shift`.
 *
 * Fetched once per mount, keyed on the uid only — never on the `users/{uid}`
 * snapshot, which presence rewrites every ten minutes (rule 9i). The route is
 * browser-cached for five minutes, and the time-tracking page remounts its body
 * on a day change or a long absence, which is what brings a stale roster up to
 * date. A failure is silent: the page simply draws no shift, exactly as it does
 * for someone who has none.
 */
export function useMyShift(): UseMyShiftReturn {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [state, setState] = useState<{ uid: string | null; shifts: ShiftSpan[] }>({ uid: null, shifts: [] });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/time-tracking/my-shift', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = (await res.json()) as { shifts?: ShiftSpan[] };
        if (!cancelled) setState({ uid: user.uid, shifts: Array.isArray(data.shifts) ? data.shifts : [] });
      } catch (err) {
        console.warn('[useMyShift] fetch failed:', err);
        if (!cancelled) setState({ uid: user.uid, shifts: [] });
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the uid, not the user object: a token refresh is not a new person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return { shifts: state.uid === uid ? state.shifts : [], loading: !!uid && state.uid !== uid };
}
