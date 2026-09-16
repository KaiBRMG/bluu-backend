'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import { invalidateShiftCalendarCache } from './useShiftCalendar';

export interface LeaveRequest {
  leaveId: string;
  shiftId: string;
  occurrenceStart: number;
  userId: string;
  leaveType: 'paid' | 'unpaid';
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Why the leave was requested. Mandatory for paid leave. */
  reason: string | null;
}

interface LeaveRequestsState {
  leaveRequests: LeaveRequest[];
  loading: boolean;
  error: string | null;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Drop one agent's cached leave requests.
 *
 * Exported for the same reason as `invalidateShiftCalendarCache`: approval
 * happens in the CA admin queue, which is a different hook on a different
 * surface, and the badge on the dashboard calendar is read from here.
 */
export function invalidateLeaveRequestsCache(uid: string): void {
  invalidateCache(cacheKey(uid));
}

function cacheKey(uid: string): string {
  return `bluu_leave_requests_v1:${uid}`;
}

/**
 * ## One store, however many components ask
 *
 * This hook used to hold its own state per instance, which broke in two ways on
 * any screen that mounted it twice — and the CA dashboard mounts it twice by
 * design (`LeaveBalanceCard` for the balance, `ShiftCalendar` for the badges on
 * each shift):
 *
 * 1. **Two identical requests on mount.** Both instances mounted together, both
 *    missed the cold `sessionStorage` cache, both hit `/api/shifts/leave`.
 * 2. **One instance could go stale while the other refreshed.** Requesting or
 *    cancelling leave in the calendar updated *the calendar's* copy; the card
 *    directly above it kept showing the old "N requests awaiting approval" until
 *    a page reload. The balance beside it *did* move (it rides the live
 *    `useUserData` snapshot), so the card showed a fresh number next to a stale
 *    one.
 *
 * So the state lives at module scope with a subscriber set, and every load goes
 * through one shared in-flight promise. Concurrent callers await the same
 * request; every mounted instance sees the same answer at the same moment.
 */
const EMPTY: LeaveRequestsState = { leaveRequests: [], loading: true, error: null };

let storeUid: string | null = null;
let storeState: LeaveRequestsState = EMPTY;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(state: LeaveRequestsState) => void>();

function emit(next: LeaveRequestsState) {
  storeState = next;
  for (const listener of listeners) listener(next);
}

/** The server's message names the rule that was hit, so it has to survive. A bare
 *  `res.json()` on a non-JSON body (an HTML 500, a proxy timeout, an empty 502)
 *  throws a SyntaxError that replaces the real status with a parse error. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return body.error as string;
  } catch {
    /* keep the status-based message */
  }
  return `${fallback} (${res.status})`;
}

async function loadInto(uid: string, getToken: () => Promise<string>, force: boolean): Promise<void> {
  if (!force) {
    const cached = getCache<LeaveRequest[]>(cacheKey(uid), CACHE_TTL_MS);
    if (cached) {
      emit({ leaveRequests: cached, loading: false, error: null });
      return;
    }
  }

  if (inFlight) {
    // Coalesce: a second component mounting mid-flight joins the request already
    // on the wire rather than starting its own.
    if (!force) return inFlight;
    // A forced reload follows a write, so it must not be answered by a request
    // that was already on the wire before it. Wait that one out, then go again.
    await inFlight;
  }

  emit({ ...storeState, loading: true, error: null });

  inFlight = (async () => {
    try {
      const idToken = await getToken();
      const res = await fetch(`/api/shifts/leave?userId=${uid}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) throw new Error(await errorMessage(res, 'Could not load leave requests'));

      const data = await res.json();
      const leaveRequests: LeaveRequest[] = data.leaveRequests ?? [];
      setCache(cacheKey(uid), leaveRequests);
      emit({ leaveRequests, loading: false, error: null });
    } catch (err) {
      console.error('[useLeaveRequests]', err);
      emit({
        ...storeState,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LeaveRequestsState {
  return storeState;
}

export function useLeaveRequests() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  // `useSyncExternalStore` rather than local state plus a subscription: it is
  // the primitive for exactly this, and it keeps every mounted consumer on the
  // same snapshot within a render pass. `storeState` is only ever replaced (not
  // mutated), so the snapshot identity is stable between emits.
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A different signed-in user must never inherit the previous one's requests.
  // In an effect, not in render — resetting module state during render is a side
  // effect whose timing depends on when React happens to re-render.
  useEffect(() => {
    if (uid === storeUid) return;
    storeUid = uid;
    inFlight = null;
    emit(uid ? EMPTY : { leaveRequests: [], loading: false, error: null });
  }, [uid]);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      if (!user) {
        emit({ leaveRequests: [], loading: false, error: null });
        return;
      }
      await loadInto(user.uid, () => user.getIdToken(), forceRefresh);
    },
    [user],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const requestLeave = useCallback(
    async (
      shiftId: string,
      occurrenceStart: number,
      leaveType: 'paid' | 'unpaid',
      reason?: string,
    ): Promise<void> => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();
      const res = await fetch('/api/shifts/leave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId, occurrenceStart, leaveType, reason }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to request leave'));

      invalidateCache(cacheKey(user.uid));
      await fetchData(true);
    },
    [user, fetchData],
  );

  const cancelLeave = useCallback(
    async (leaveId: string): Promise<void> => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/shifts/leave/${leaveId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to cancel leave'));

      invalidateCache(cacheKey(user.uid));
      // Withdrawing *approved* leave puts the shift occurrence back on the
      // roster, so the cached calendar is now wrong in the other direction —
      // missing a shift the agent is working again.
      invalidateShiftCalendarCache(user.uid);
      await fetchData(true);
    },
    [user, fetchData],
  );

  const getLeaveForShift = useCallback(
    (shiftId: string, occurrenceStart: number): LeaveRequest | null => {
      return (
        state.leaveRequests.find(lr => lr.shiftId === shiftId && lr.occurrenceStart === occurrenceStart) ?? null
      );
    },
    [state.leaveRequests],
  );

  return {
    ...state,
    getLeaveForShift,
    requestLeave,
    cancelLeave,
    refetch: () => fetchData(true),
  };
}
