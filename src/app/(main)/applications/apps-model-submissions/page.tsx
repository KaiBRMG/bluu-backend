'use client';

import { useMemo, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import AppLayout from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useModelSubmissions, useSubmissionDetail } from '@/hooks/useModelSubmissions';
import { SUBMISSION_STATUS_META } from '@/lib/modelSubmissions';
import type { SubmissionStatus } from '@/types/modelSubmission';
import { SubmissionCard } from './components/SubmissionCard';
import { SubmissionDetail } from './components/SubmissionDetail';

type Filter = SubmissionStatus | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const EMPTY_COPY: Record<Filter, string> = {
  new: 'Nothing waiting. Every application has been reviewed.',
  approved: 'No approved applications yet.',
  rejected: 'No rejected applications.',
  all: 'No applications have come in yet. They appear here the moment someone submits the public form.',
};

export default function ModelSubmissionsAdminPage() {
  const { submissions, error, setStatus } = useModelSubmissions();
  const [filter, setFilter] = useState<Filter>('new');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);

  const [openId, setOpenId] = useState<string | null>(null);
  const { detail, loading: detailLoading } = useSubmissionDetail(openId);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { new: 0, approved: 0, rejected: 0, all: 0 };
    for (const s of submissions ?? []) {
      base[s.status] += 1;
      base.all += 1;
    }
    return base;
  }, [submissions]);

  const visible = useMemo(() => {
    if (!submissions) return [];
    const q = debouncedQuery.trim().toLowerCase();
    return submissions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q)
      );
    });
  }, [submissions, filter, debouncedQuery]);

  const loading = submissions === null;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Model Submissions</h1>
            <p className="text-sm text-muted-foreground">
              Applications from the public form. Page through the photos, then approve or reject.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or location"
              aria-label="Search submissions"
              className="pl-9"
            />
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {FILTERS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="gap-2">
                {value !== 'all' && (
                  <span
                    className={`inline-block size-2 rounded-full ${SUBMISSION_STATUS_META[value as SubmissionStatus].dot}`}
                    aria-hidden
                  />
                )}
                {label}
                {counts[value] > 0 && (
                  <Badge variant="secondary" className="tabular-nums">
                    {counts[value]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* ── Queue ───────────────────────────────────────────────────── */}
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {/* Shaped to the real card, and sharing its 9:16 frame, so the
                placeholder occupies exactly the space the card will — no jump
                when the data lands, at any column width. */}
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]"
              >
                <Skeleton className="aspect-[9/16] rounded-none" />
                <div className="flex flex-col gap-3 p-3">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-16 self-end" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-sm text-muted-foreground">
            {debouncedQuery.trim()
              ? `No submissions match “${debouncedQuery.trim()}”.`
              : EMPTY_COPY[filter]}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {visible.map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                onOpen={() => setOpenId(submission.id)}
                onSetStatus={(status) => void setStatus(submission.id, status)}
              />
            ))}
          </div>
        )}
      </div>

      <SubmissionDetail
        detail={detail}
        loading={detailLoading}
        open={openId !== null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        onSetStatus={(status) => {
          if (!openId) return;
          void setStatus(openId, status);
          setOpenId(null);
        }}
      />
    </AppLayout>
  );
}
