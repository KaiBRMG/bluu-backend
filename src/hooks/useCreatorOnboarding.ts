'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { InquirySummary, OnboardingDetail, OnboardingSummary } from '@/types/creatorOnboarding';

/**
 * Data for Creator Portal → Onboarding.
 *
 * Deliberately uncached across navigations: the list is small, and its whole
 * point is freshness ("did anyone finish since this morning?"). Opened records
 * are kept in memory for the tab only — they are applicants' answers, the most
 * personal data the product holds, and must not land on disk.
 */
const detailCache = new Map<string, OnboardingDetail>();

export function useOnboardings() {
  const authFetch = useAuthFetch();
  const [onboardings, setOnboardings] = useState<OnboardingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/creator-onboarding')
      .then((data) => {
        if (cancelled) return;
        setOnboardings(data.onboardings ?? []);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Could not load onboarding';
        setOnboardings((prev) => {
          if (prev === null) setError(message);
          else toast.error(message);
          return prev ?? [];
        });
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, key]);

  /** Rotates the link and re-sends the welcome email. */
  const resend = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const data = await authFetch('/api/creator-onboarding/invite', {
          method: 'POST',
          body: JSON.stringify({ submissionId: id }),
        });
        toast.success('New onboarding link sent', { description: data?.to ? `To ${data.to}` : undefined });
        detailCache.delete(id);
        reload();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not send the email');
        return false;
      }
    },
    [authFetch, reload],
  );

  return { onboardings, error, reload, resend };
}

/** One applicant's full answers. Derived during render from the cache, like `useSubmissionDetail`. */
export function useOnboardingDetail(id: string | null) {
  const authFetch = useAuthFetch();
  const [loaded, setLoaded] = useState<OnboardingDetail | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const detail = id ? (detailCache.get(id) ?? (loaded?.id === id ? loaded : null)) : null;
  const loading = id !== null && detail === null && failedId !== id;

  useEffect(() => {
    if (!id || detailCache.has(id)) return;
    let cancelled = false;
    authFetch(`/api/creator-onboarding/${id}`)
      .then((data) => {
        const record = data.onboarding as OnboardingDetail;
        // Only cache a finished form: an in-progress one is still changing.
        if (record.status === 'completed') detailCache.set(record.id, record);
        if (!cancelled) setLoaded(record);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailedId(id);
        toast.error(e instanceof Error ? e.message : 'Could not load answers');
      });
    return () => {
      cancelled = true;
    };
  }, [id, authFetch]);

  return { detail, loading };
}

export function useInquiries(enabled: boolean) {
  const authFetch = useAuthFetch();
  const [inquiries, setInquiries] = useState<InquirySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    authFetch('/api/creator-inquiries')
      .then((data) => {
        if (cancelled) return;
        setInquiries(data.inquiries ?? []);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load the inbox');
        setInquiries((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, enabled, key]);

  /** Optimistic: the row flips to Replied at once and rolls back on refusal. */
  const reply = useCallback(
    async (id: string) => {
      const previous = inquiries;
      setInquiries(
        (prev) =>
          prev?.map((q) => (q.id === id ? { ...q, outcome: 'replied', repliedAt: new Date().toISOString() } : q)) ?? null,
      );
      try {
        await authFetch(`/api/creator-inquiries/${id}/reply`, { method: 'POST' });
        toast.success('Reply sent');
        reload();
      } catch (e) {
        setInquiries(previous);
        toast.error(e instanceof Error ? e.message : 'Could not send the reply');
      }
    },
    [authFetch, inquiries, reload],
  );

  return { inquiries, error, reload, reply };
}
