'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCache, setCache } from '@/lib/queryCache';
import type {
  ModelSubmissionDetail,
  ModelSubmissionSummary,
  SubmissionStatus,
} from '@/types/modelSubmission';

/**
 * Opened records, kept for the life of the tab.
 *
 * A reviewer commonly opens a submission, closes it, and opens it again — or
 * steps through several and comes back. Re-fetching would blank the dialog to
 * skeletons and re-download the full-size photos every time. Held in memory
 * rather than `sessionStorage` because these payloads carry contact details;
 * they should not outlive the tab or land on disk.
 */
const detailCache = new Map<string, ModelSubmissionDetail>();

const LIST_CACHE_KEY = 'bluu_model_submissions_v1';
/**
 * Shorter than the 30-minute signing window on the server, so a cached summary
 * can never hold a URL that has drifted out of its window.
 */
const LIST_TTL_MS = 10 * 60 * 1000;

/**
 * The review queue.
 *
 * Cached in `sessionStorage` and served **immediately** on mount, then
 * revalidated in the background. Combined with the server pinning signed URLs
 * to a 30-minute window, this is what makes returning to the page paint the
 * grid instantly instead of flashing skeletons and re-downloading every
 * thumbnail: the cached rows carry the same URLs the browser already has bytes
 * for, so the images are simply already on screen.
 */
export function useModelSubmissions() {
  const authFetch = useAuthFetch();
  // Seed from cache during the initial state computation, so the very first
  // paint already has rows — not after an effect has run.
  const [submissions, setSubmissions] = useState<ModelSubmissionSummary[] | null>(
    () => getCache<ModelSubmissionSummary[]>(LIST_CACHE_KEY, LIST_TTL_MS),
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  /** Bumping the key is what re-runs the fetch; the effect owns every setState. */
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/model-submissions/admin')
      .then((data) => {
        if (cancelled) return;
        const next: ModelSubmissionSummary[] = data.submissions ?? [];
        setCache(LIST_CACHE_KEY, next);
        setSubmissions(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Could not load submissions';
        // A failed revalidation must not throw away rows we can still show. The
        // error surfaces only when there is nothing on screen to keep.
        setSubmissions((prev) => {
          if (prev === null) setError(message);
          else toast.error(message);
          return prev ?? [];
        });
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, refreshKey]);

  /**
   * Optimistic status write. The card flips immediately (a reviewer moving
   * through a queue should never wait on a round trip) and rolls back with a
   * toast if the server refuses.
   */
  const setStatus = useCallback(
    async (id: string, status: SubmissionStatus) => {
      const previous = submissions;
      const optimistic = previous?.map((s) => (s.id === id ? { ...s, status } : s)) ?? null;
      setSubmissions(optimistic);
      // Keep the cache in step, so a navigation away and back mid-flight shows
      // the decision the reviewer just made rather than the stale one.
      if (optimistic) setCache(LIST_CACHE_KEY, optimistic);

      try {
        await authFetch(`/api/model-submissions/admin/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        toast.success(
          status === 'approved'
            ? 'Submission approved'
            : status === 'rejected'
              ? 'Submission rejected'
              : 'Moved back to new',
        );
        // The detail copy now has a stale status and review trail.
        detailCache.delete(id);
        // Re-read so `reviewedBy` / `reviewedAt` reflect what the server stored.
        // Photo URLs come back identical inside the signing window, so nothing
        // re-downloads and the grid does not repaint.
        reload();
      } catch (e) {
        setSubmissions(previous);
        if (previous) setCache(LIST_CACHE_KEY, previous);
        toast.error(e instanceof Error ? e.message : 'Could not update the submission');
      }
    },
    [authFetch, reload, submissions],
  );

  return { submissions, error, reload, setStatus };
}

/**
 * Fetches one full record. Pass `null` to clear.
 *
 * `detail` and `loading` are **derived during render** from the cache, not
 * pushed in from an effect. That's what makes reopening a record you've already
 * seen paint it in the same frame: an effect would necessarily render `null`
 * first, and the dialog would flash skeletons over photos the browser already
 * has in memory.
 */
export function useSubmissionDetail(id: string | null) {
  const authFetch = useAuthFetch();
  const [loaded, setLoaded] = useState<ModelSubmissionDetail | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const detail = id ? (detailCache.get(id) ?? (loaded?.id === id ? loaded : null)) : null;
  const loading = id !== null && detail === null && failedId !== id;

  useEffect(() => {
    // A cached record needs no request at all — the render above already has it.
    if (!id || detailCache.has(id)) return;

    let cancelled = false;
    authFetch(`/api/model-submissions/admin/${id}`)
      .then((data) => {
        const record = data.submission as ModelSubmissionDetail;
        detailCache.set(record.id, record);
        if (!cancelled) setLoaded(record);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Marks the attempt done so the dialog stops showing skeletons for a
        // record that is never going to arrive.
        setFailedId(id);
        toast.error(e instanceof Error ? e.message : 'Could not load submission');
      });

    return () => {
      cancelled = true;
    };
  }, [id, authFetch]);

  return { detail, loading };
}

/** Drops every cached copy. Call after anything that invalidates the queue. */
export function clearModelSubmissionCache(): void {
  invalidateCache(LIST_CACHE_KEY);
  detailCache.clear();
}
