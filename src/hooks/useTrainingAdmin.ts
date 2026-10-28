'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { apiRequest } from '@/lib/clientApi';
import { makePreview } from '@/components/admin/training/makePreview';
import { UPLOAD_GRACE_MS } from '@/lib/training/modules';
import type {
  AdminCandidateDetail,
  AdminCandidateRow,
  AdminSessionDetail,
  AdminSessionProgress,
  AdminSessionRow,
  AdminSubmissionView,
  CandidateStatus,
} from '@/lib/training/types';

// ─── Live refresh ────────────────────────────────────────────────────────────
//
// An admin on these pages is usually watching a test as it happens, so what
// they see re-reads on its own. Every training collection is `if false` to the
// client SDK, so there is no snapshot listener to lean on: it is HTTP, on a
// beat, and only while something can change — a clock running, or a part open
// that someone could start. Nothing polls while the window is hidden, an
// idle page costs nothing, and a return to the window reads once (rule 9i).

/** While someone is mid-attempt: one recording segment, so the roster keeps pace with the live player. */
export const LIVE_POLL_MS = 10_000;
/** While a part is open and nobody is in it yet: waiting for someone to press Start. */
const OPEN_POLL_MS = 15_000;
/** The Candidates tab reads every participant document, so it runs on a slower beat. */
const LIST_POLL_MS = 30_000;
/** Keep watching this long past a deadline: the last uploads land inside the grace, after the state flips. */
const TAIL_MS = UPLOAD_GRACE_MS + LIVE_POLL_MS;
/** `setTimeout`'s ceiling; a later boundary simply fires early and re-arms. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

interface LivePart {
  state: CandidateStatus;
  deadlineMs: number | null;
  reopenedAtMs: number | null;
}

/**
 * A clock is running on this part, or ran out so recently that its last uploads
 * may still land. A Stop ends an attempt at `closesAtMs`, ahead of its own
 * deadline — unless it was reopened after access ended, which gave it its own.
 */
export function isLivePart(part: LivePart, nowMs: number, closesAtMs: number): boolean {
  if (part.state === 'in-progress') return true;
  if (part.state !== 'timed-out' || part.deadlineMs === null) return false;
  const reopenedLater = part.reopenedAtMs !== null && part.reopenedAtMs > closesAtMs;
  const endedMs = reopenedLater ? part.deadlineMs : Math.min(part.deadlineMs, closesAtMs);
  return nowMs < endedMs + TAIL_MS;
}

/** How often to re-read, given the parts on screen: fast while a clock runs, slower while one could start, never otherwise. */
function beatFor(parts: (LivePart & { closesAtMs: number })[], nowMs: number): number | null {
  if (parts.some((p) => isLivePart(p, nowMs, p.closesAtMs))) return LIVE_POLL_MS;
  if (parts.some((p) => p.state === 'open')) return OPEN_POLL_MS;
  return null;
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

export function useTrainingSessions() {
  const [sessions, setSessions] = useState<AdminSessionRow[] | null>(null);
  // The server's clock, so a status is judged against it and no render reads the time.
  const [nowMs, setNowMs] = useState(0);
  const [skewMs, setSkewMs] = useState(0);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // A status (Upcoming → Running → Closed) only changes at a known instant, so
  // the list advances its clock at the next one — no read needed.
  const boundary = useMemo(
    () => (sessions ? nextBoundary(sessions.flatMap((s) => [s.firstOpensAtMs, s.closesAtMs]), nowMs) : null),
    [sessions, nowMs],
  );
  useLiveRefresh(() => setNowMs(Date.now() + skewMs), null, boundary, skewMs);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<{ nowMs: number; sessions: AdminSessionRow[] }>('sessions')
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        setNowMs(res.nowMs);
        setSkewMs(res.nowMs - Date.now());
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load sessions');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { sessions, nowMs, error, refetch };
}

/**
 * `next` in the order `prev` already shows, newcomers last. A poll updates rows
 * where they stand: re-sorting by status under the reader would move a row as
 * they click it (DESIGN.md — a list never reorders under the reader).
 */
function inPlace(prev: AdminCandidateRow[], next: AdminCandidateRow[]): AdminCandidateRow[] {
  const at = new Map(prev.map((c, i) => [c.emailHash, i]));
  return [...next].sort((a, b) => (at.get(a.emailHash) ?? prev.length) - (at.get(b.emailHash) ?? prev.length));
}

export function useTrainingCandidates() {
  const [candidates, setCandidates] = useState<AdminCandidateRow[] | null>(null);
  const [error, setError] = useState('');
  const [load, setLoad] = useState({ key: 0, keepOrder: false });
  const refetch = useCallback(() => setLoad((l) => ({ key: l.key + 1, keepOrder: false })), []);
  const poll = useCallback(() => setLoad((l) => ({ key: l.key + 1, keepOrder: true })), []);

  const live = !!candidates?.some((c) => c.status === 'in-progress' || c.status === 'open');
  useLiveRefresh(poll, live ? LIST_POLL_MS : null);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<{ candidates: AdminCandidateRow[] }>('candidates')
      .then((res) => {
        if (cancelled) return;
        setCandidates((prev) => (load.keepOrder && prev ? inPlace(prev, res.candidates) : res.candidates));
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load candidates');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { candidates, error, refetch };
}

/** One candidate across every session. Keyed by the caller, so a new candidate is a new instance. */
export function useTrainingCandidate(emailHash: string) {
  const [detail, setDetail] = useState<AdminCandidateDetail | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // A refresh keeps the last detail on screen (never back to null), so an open
  // recording player is not torn down by it.
  const live = useMemo(() => {
    if (!detail) return { every: null, at: null };
    const parts = detail.sessions
      .filter((s) => s.revokedAtMs == null)
      .flatMap((s) => s.parts.map((p) => ({ ...p, closesAtMs: s.closesAtMs })));
    return {
      every: beatFor(parts, detail.nowMs),
      at: nextBoundary([...detail.sessions.map((s) => s.closesAtMs), ...parts.map((p) => p.deadlineMs)], detail.nowMs),
    };
  }, [detail]);
  useLiveRefresh(refetch, live.every, live.at, skewMs);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<AdminCandidateDetail>(`candidates/${emailHash}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setSkewMs(res.nowMs - Date.now());
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this candidate');
      });
    return () => {
      cancelled = true;
    };
  }, [emailHash, refreshKey]);

  return { detail, skewMs, error, refetch };
}

export function useTrainingSession(sessionId: string) {
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [error, setError] = useState('');
  // A poll reads only the roster (`?view=progress`); everything else reads it
  // all. A poll never supersedes a full read still in flight — that read is
  // what brings a just-added source image in.
  const [load, setLoad] = useState({ key: 0, progress: false });
  const fullPending = useRef(true);
  const refetch = useCallback(() => setLoad((l) => ({ key: l.key + 1, progress: false })), []);
  const poll = useCallback(() => setLoad((l) => ({ key: l.key + 1, progress: !fullPending.current })), []);

  useEffect(() => {
    let cancelled = false;
    if (!load.progress) fullPending.current = true;
    const read: Promise<{ nowMs: number; apply: (prev: AdminSessionDetail | null) => AdminSessionDetail | null }> = load.progress
      ? trainingAdmin<AdminSessionProgress>(`sessions/${sessionId}?view=progress`).then((res) => ({
          nowMs: res.nowMs,
          apply: (prev) =>
            prev && { ...prev, nowMs: res.nowMs, session: { ...prev.session, ...res.session }, participants: res.participants },
        }))
      : trainingAdmin<AdminSessionDetail>(`sessions/${sessionId}`).then((res) => ({ nowMs: res.nowMs, apply: () => res }));
    read
      .then(({ nowMs, apply }) => {
        if (cancelled) return;
        if (!load.progress) fullPending.current = false;
        setDetail(apply);
        setSkewMs(nowMs - Date.now());
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the session');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, load]);

  // Fast while anyone's clock runs, slower while a part is open for someone to
  // start, and a single read at the next scheduled flip (a part opening, a
  // deadline, access ending) — so an admin watching sees a candidate press
  // Start, upload, and run out of time without touching anything.
  const live = useMemo(() => {
    if (!detail) return { every: null, at: null };
    const { closesAtMs } = detail.session;
    const parts = detail.participants
      .filter((p) => p.revokedAtMs == null)
      .flatMap((p) => Object.values(p.parts).map((x) => ({ ...x, closesAtMs })));
    return {
      every: beatFor(parts, detail.nowMs),
      at: nextBoundary(
        [
          detail.session.closesAtMs,
          ...Object.values(detail.session.parts).map((p) => p.opensAtMs),
          ...parts.map((p) => p.deadlineMs),
        ],
        detail.nowMs,
      ),
    };
  }, [detail]);
  useLiveRefresh(poll, live.every, live.at, skewMs);

  const base = `sessions/${sessionId}`;

  const update = useCallback(
    async (patch: { label?: string; closesAtMs?: number; opensAtMs?: Record<string, number> }) => {
      await trainingAdmin(base, 'PATCH', patch);
      refetch();
    },
    [base, refetch],
  );

  const stop = useCallback(async () => {
    await trainingAdmin(`${base}/stop`, 'POST');
    refetch();
  }, [base, refetch]);

  const reopen = useCallback(
    async (emailHash: string, partId: string) => {
      await trainingAdmin(`${base}/participants/${emailHash}/reopen`, 'POST', { partId });
      refetch();
    },
    [base, refetch],
  );

  const addPeople = useCallback(
    async (emails: string) => {
      const res = await trainingAdmin<{ added: number }>(`${base}/participants`, 'POST', { emails });
      refetch();
      return res.added;
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

  /** Adds one source image: a preview made here, two direct PUTs, then a commit that verifies both. */
  const addSource = useCallback(
    async (partId: string, file: File) => {
      const preview = await makePreview(file);
      const sig = await trainingAdmin<{ imageId: string; fullUrl: string; thumbUrl: string }>(
        `${base}/sources`,
        'POST',
        { action: 'sign', partId, contentType: file.type, size: file.size, previewSize: preview.size },
      );
      const put = (url: string, blob: Blob, type: string) =>
        fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: blob }).then((r) => {
          if (!r.ok) throw new Error('The upload to storage failed');
        });
      await Promise.all([put(sig.fullUrl, file, file.type), put(sig.thumbUrl, preview, 'image/webp')]);
      await trainingAdmin(`${base}/sources`, 'POST', {
        action: 'commit',
        partId,
        imageId: sig.imageId,
        name: file.name,
        contentType: file.type,
      });
    },
    [base],
  );

  /** `retired`: the part had opened, so anyone already using the image keeps it (see `removeSource` on the server). */
  const removeSource = useCallback(
    async (partId: string, imageId: string) => {
      const res = await trainingAdmin<{ retired: boolean }>(`${base}/sources`, 'DELETE', { partId, imageId });
      refetch();
      return res;
    },
    [base, refetch],
  );

  const loadSubmission = useCallback(
    (emailHash: string, partId: string) =>
      trainingAdmin<AdminSubmissionView>(`${base}/participants/${emailHash}?part=${encodeURIComponent(partId)}`),
    [base],
  );

  return { detail, skewMs, error, refetch, update, stop, reopen, addPeople, revoke, addSource, removeSource, loadSubmission };
}
