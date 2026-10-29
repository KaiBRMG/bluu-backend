'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/clientApi';
import { WORKING_GRACE_MS } from '@/lib/training/modules';
import type {
  AdminModuleDetail,
  AdminModuleRow,
  AdminSubmissionView,
  MaterialCheck,
  SyncPlan,
  TestState,
} from '@/lib/training/types';

// ─── Live refresh ────────────────────────────────────────────────────────────
//
// An admin on these pages is usually watching a test as it happens, so what
// they see re-reads on its own. Every training collection is `if false` to the
// client SDK, so there is no snapshot listener to lean on: it is HTTP, on a
// beat, and only while something can change — a clock running, or a test open
// that someone could start. Nothing polls while the window is hidden, an
// idle page costs nothing, and a return to the window reads once (rule 9i).

/** While someone is mid-attempt: one recording segment, so the roster keeps pace with the live player. */
export const LIVE_POLL_MS = 10_000;
/** While a test is open and nobody is in it yet: waiting for someone to press Start. */
const OPEN_POLL_MS = 15_000;
/** Keep watching this long past a deadline: the last uploads land inside the grace, after the state flips. */
const TAIL_MS = WORKING_GRACE_MS + LIVE_POLL_MS;
/** `setTimeout`'s ceiling; a later boundary simply fires early and re-arms. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

interface LiveCell {
  state: TestState;
  deadlineMs: number | null;
}

/**
 * A clock is running on this attempt, or ran out so recently that its last
 * uploads may still land (the grace plus a beat).
 */
export function isLiveCell(cell: LiveCell, nowMs: number): boolean {
  if (cell.state === 'in-progress') return true;
  return cell.state === 'timed-out' && cell.deadlineMs !== null && nowMs < cell.deadlineMs + TAIL_MS;
}

/** The soonest of `times` still ahead of `nowMs` — the next moment a state flips on the server's clock. */
function nextBoundary(times: (number | null)[], nowMs: number): number | null {
  let next: number | null = null;
  for (const t of times) if (t !== null && t > nowMs && (next === null || t < next)) next = t;
  return next;
}

/**
 * Calls `refresh` every `everyMs` (null = not at all), once just after the
 * server-clock instant `atServerMs` (so a part opening or a clock running out
 * shows on time rather than a beat late), and whenever the window comes back
 * into view. Never while the window is hidden.
 */
export function useLiveRefresh(refresh: () => void, everyMs: number | null, atServerMs: number | null = null, skewMs = 0) {
  const tick = useEffectEvent(() => {
    if (document.visibilityState === 'visible') refresh();
  });
  useEffect(() => {
    if (everyMs === null) return;
    const id = window.setInterval(tick, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  useEffect(() => {
    if (atServerMs === null) return;
    // A second late, so the server's clock has passed it too.
    const delay = Math.min(Math.max(0, atServerMs - (Date.now() + skewMs) + 1000), MAX_TIMEOUT_MS);
    const id = window.setTimeout(tick, delay);
    return () => window.clearTimeout(id);
  }, [atServerMs, skewMs]);
  useEffect(() => {
    document.addEventListener('visibilitychange', tick);
    return () => document.removeEventListener('visibilitychange', tick);
  }, []);
}

/** One call to the admin training API; throws the server's own message on failure. */
export async function trainingAdmin<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await apiRequest(`/api/admin/training/${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* keep the generic message */
  }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error || `Request failed: ${res.status}`);
  return data as T;
}

export function useTrainingModules() {
  const [modules, setModules] = useState<AdminModuleRow[] | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<{ modules: AdminModuleRow[] }>('modules')
      .then((res) => {
        if (cancelled) return;
        setModules(res.modules);
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the modules');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { modules, error, refetch };
}

/** The files Open is copying from Drive, shown as `23 / 41`. */
export interface Preparing {
  testId: string;
  done: number;
  total: number;
}

/** `invited` were emailed; `held` are new but were not, because the module is off. */
export interface AddPeopleResult {
  added: number;
  invited: number;
  held: number;
}

export function useTrainingModule(moduleId: string) {
  const [detail, setDetail] = useState<AdminModuleDetail | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState<Preparing | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<AdminModuleDetail>(`modules/${moduleId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setSkewMs(res.nowMs - Date.now());
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the module');
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, refreshKey]);

  // Fast while anyone's clock runs, slower while a test is open for someone to
  // start, and a single read at the next deadline — so an admin watching sees a
  // candidate press Start, upload and run out of time without touching anything.
  // A re-read keeps the last detail on screen, so an open recording player is not torn down.
  const live = useMemo(() => {
    if (!detail) return { every: null, at: null };
    const cells = detail.participants.filter((p) => p.revokedAtMs == null).flatMap((p) => Object.values(p.tests));
    const every = cells.some((c) => isLiveCell(c, detail.nowMs))
      ? LIVE_POLL_MS
      : detail.module.openTestId
        ? OPEN_POLL_MS
        : null;
    return { every, at: nextBoundary(cells.map((c) => c.deadlineMs), detail.nowMs) };
  }, [detail]);
  useLiveRefresh(refetch, live.every, live.at, skewMs);

  const base = `modules/${moduleId}`;

  const setOn = useCallback(
    async (on: boolean) => {
      await trainingAdmin(base, 'PATCH', { on });
      refetch();
    },
    [base, refetch],
  );

  /** Check Drive: a dry run. Writes nothing. */
  const check = useCallback((testId: string) => trainingAdmin<MaterialCheck>(`${base}/tests/${testId}/check`), [base]);

  /**
   * Open: copy what changed in Drive into Storage, one file per call (about 120
   * files is too many for one invocation), then open. The server refuses the
   * final step until every file is in, so an interrupted run leaves the test
   * `preparing` and pressing Open again resumes it.
   */
  const openTest = useCallback(
    async (testId: string) => {
      const t = `${base}/tests/${testId}`;
      setPreparing({ testId, done: 0, total: 0 });
      try {
        const plan = await trainingAdmin<SyncPlan>(`${t}/prepare`, 'POST');
        setPreparing({ testId, done: 0, total: plan.todo.length });
        for (const [i, file] of plan.todo.entries()) {
          try {
            await trainingAdmin(`${t}/prepare/file`, 'POST', { key: file.key, driveId: file.driveId });
          } catch {
            // One retry: a download that did not arrive intact is the usual cause.
            await trainingAdmin(`${t}/prepare/file`, 'POST', { key: file.key, driveId: file.driveId });
          }
          setPreparing({ testId, done: i + 1, total: plan.todo.length });
        }
        await trainingAdmin(`${t}/open`, 'POST');
      } finally {
        setPreparing(null);
        refetch();
      }
    },
    [base, refetch],
  );

  const closeTest = useCallback(
    async (testId: string) => {
      await trainingAdmin(`${base}/tests/${testId}/close`, 'POST');
      refetch();
    },
    [base, refetch],
  );

  const reopen = useCallback(
    async (emailHash: string, testId: string) => {
      await trainingAdmin(`${base}/participants/${emailHash}/reopen`, 'POST', { testId });
      refetch();
    },
    [base, refetch],
  );

  const addPeople = useCallback(
    async (emails: string) => {
      const res = await trainingAdmin<AddPeopleResult>(`${base}/participants`, 'POST', { emails });
      refetch();
      return res;
    },
    [base, refetch],
  );

  const revoke = useCallback(
    async (emailHash: string) => {
      await trainingAdmin(`${base}/participants`, 'DELETE', { emailHash });
      refetch();
    },
    [base, refetch],
  );

  /** Retry the Drive copy of one attempt; resolves with how many files it tried. */
  const retryMirror = useCallback(
    async (emailHash: string, testId: string) => {
      const res = await trainingAdmin<{ copied: number }>(`${base}/participants/${emailHash}/mirror`, 'POST', { testId });
      refetch();
      return res.copied;
    },
    [base, refetch],
  );

  const loadSubmission = useCallback(
    (emailHash: string, testId: string) =>
      trainingAdmin<AdminSubmissionView>(`${base}/participants/${emailHash}/submission?test=${encodeURIComponent(testId)}`),
    [base],
  );

  return {
    detail,
    skewMs,
    error,
    preparing,
    refetch,
    setOn,
    check,
    openTest,
    closeTest,
    reopen,
    addPeople,
    revoke,
    retryMirror,
    loadSubmission,
  };
}
