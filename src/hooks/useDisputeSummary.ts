'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { DisputeDocument } from '@/types/firestore';

/**
 * The dashboard's Sale Disputes column, in one read.
 *
 * ## Why this is not `useDisputesData`
 *
 * That hook is the paginated *list* — a filter and a page number, one request
 * per feed. The column is the opposite shape: three small fixed slices that
 * always arrive together, and arriving together is the point (a count in the
 * heading that disagrees with the rows under it is worse than no count). So it
 * reads one endpoint, `/api/disputes/summary`, which is also what keeps this to
 * two Firestore queries instead of three — see that route for the arithmetic.
 *
 * ## Staleness
 *
 * Same policy as everything else on this dashboard (ca-salary.md §6): this
 * renderer stays open for weeks (CLAUDE.md rule 9c), so a read done once at
 * mount would show a fortnight-old queue. It revalidates when the window comes
 * back to the user, and the panel carries a manual refresh for the agent who
 * sits watching the screen and therefore never blurs it.
 *
 * **Nothing is cached.** A verdict is a decision someone is waiting on, and a
 * two-minute `sessionStorage` TTL here would mean approving a dispute in the
 * All-disputes dialog and watching the column still offer it. The payload is
 * three short slices; the cost of always being right is one small request.
 *
 * ## `refetch` never blanks the panel
 *
 * `loading` is only true before the first payload lands. A revalidation sets
 * `refreshing` instead, so the rows stay readable and in place while they are
 * re-read — collapsing a queue back into its skeleton on every window focus is
 * how a dashboard loses the row someone was aiming at.
 */

export interface DisputeSummary {
  review: { total: number; disputes: DisputeDocument[] };
  mine: {
    total: number;
    awaitingCa: number;
    awaitingAdmin: number;
    disputes: DisputeDocument[];
  };
  decided: DisputeDocument[];
}

export interface UseDisputeSummary {
  summary: DisputeSummary | null;
  /** True only until the first payload lands — never on a revalidation. */
  loading: boolean;
  refreshing: boolean;
  /** The server's own wording, or a generic fallback. Never swallowed. */
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDisputeSummary(): UseDisputeSummary {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [summary, setSummary] = useState<DisputeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards two things at once: a response landing after unmount, and a
  // revalidation triggered by focus overtaking the one already in flight.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const id = ++requestId.current;
    // `setSummary` has not run yet on the first call, so this reads the
    // *previous* payload — which is exactly the question being asked: is there
    // something on screen worth keeping while we re-read?
    setRefreshing(true);
    try {
      const data = await authFetch('/api/disputes/summary');
      if (!mounted.current || id !== requestId.current) return;
      setSummary(data as DisputeSummary);
      setError(null);
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return;
      console.error('[useDisputeSummary] load failed:', err);
      // A failed read is a state, never an empty list (ca-salary.md §6). The
      // previous payload is deliberately left in place: stale rows the agent
      // can still act on beat an empty column that reads as "nothing to do".
      setError(err instanceof Error ? err.message : 'Could not load your disputes');
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user, authFetch]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  // Returning to the window is when an agent next looks at this, and it is the
  // only signal that reaches a dashboard left open across a reviewer's sitting.
  useEffect(() => {
    if (!user) return;
    const sync = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [user, load]);

  return { summary, loading, refreshing, error, refetch: load };
}
