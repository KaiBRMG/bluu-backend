'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { apiRequest } from '@/lib/clientApi';
import { makePreview } from '@/components/admin/training/makePreview';
import type { AdminSessionDetail, AdminSessionRow, AdminSubmissionView } from '@/lib/training/types';

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
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<{ nowMs: number; sessions: AdminSessionRow[] }>('sessions')
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        setNowMs(res.nowMs);
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

export function useTrainingSession(sessionId: string) {
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<AdminSessionDetail>(`sessions/${sessionId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the session');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  // States flip on the server clock (a part opens, a clock runs out), so a
  // session that is under way re-reads on a slow beat — but only while someone
  // is mid-attempt or a part is about to open, only while the window is
  // visible, and never after access ends. An idle session costs nothing, and an
  // Electron window left open for weeks costs nothing either (rule 9i).
  const poll = useEffectEvent(() => {
    if (document.visibilityState !== 'visible' || !detail) return;
    const now = Date.now();
    if (now > detail.session.closesAtMs) return;
    const soon = Object.values(detail.session.parts).some((p) => p.opensAtMs - now < 5 * 60_000 && p.opensAtMs - now > -5 * 60_000);
    const running = detail.participants.some((p) => Object.values(p.parts).some((x) => x.state === 'in-progress'));
    if (soon || running) refetch();
  });
  useEffect(() => {
    const id = window.setInterval(poll, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const base = `sessions/${sessionId}`;

  const update = useCallback(
    async (patch: { label?: string; closesAtMs?: number; opensAtMs?: Record<string, number> }) => {
      await trainingAdmin(base, 'PATCH', patch);
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

  const removeSource = useCallback(
    async (partId: string, imageId: string) => {
      await trainingAdmin(`${base}/sources`, 'DELETE', { partId, imageId });
      refetch();
    },
    [base, refetch],
  );

  const loadSubmission = useCallback(
    (emailHash: string, partId: string) =>
      trainingAdmin<AdminSubmissionView>(`${base}/participants/${emailHash}?part=${encodeURIComponent(partId)}`),
    [base],
  );

  return { detail, error, refetch, update, addPeople, revoke, addSource, removeSource, loadSubmission };
}
