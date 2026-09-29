'use client';

import { useMemo, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import AppLayout from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useInquiries, useOnboardingDetail, useOnboardings } from '@/hooks/useCreatorOnboarding';
import { ONBOARDING_STAGE_META, onboardingStage, type OnboardingStage } from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { AnswersSheet } from './components/AnswersSheet';
import { ApplicantRow } from './components/ApplicantRow';
import { FilterChips } from './components/FilterChips';
import { Inbox, needsALook } from './components/Inbox';

type Filter = OnboardingStage | 'all';

/** Completed first: it is the page's reason to exist — the people ready to be messaged. */
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'started', label: 'In progress' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'invited', label: 'Not opened' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<Filter, string> = {
  completed: 'Nobody has finished onboarding yet. Completed forms land here, with the Telegram handle to message.',
  started: 'Nobody is part-way through right now.',
  stalled: 'No stalled forms — everyone who started has been active in the last few days.',
  invited: 'Everyone invited has opened their link.',
  all: 'No onboarding links have been sent yet. Approve an application in Model Submissions to send the first.',
};

/**
 * Creator Portal → Onboarding.
 *
 * Two jobs, as two tabs:
 *   - **Applicants** — everyone emailed an onboarding link, by stage. The main
 *     action is on the Completed rows: message the creator on Telegram. Many
 *     people start and never finish, so "Stalled" is a derived stage (started,
 *     silent for STALL_AFTER_DAYS) with a one-click fresh link.
 *   - **Inbox** — every email hello@bluurock.com received and what the rules
 *     filter did with it, so a held enquiry or a false positive is one click
 *     from a reply.
 *
 * A list of people, not a card grid: the decision here is "who do I message",
 * which reads down a column of names and handles.
 */
export default function CreatorOnboardingPage() {
  const [tab, setTab] = useState<'applicants' | 'inbox'>('applicants');
  const { onboardings, error, resend } = useOnboardings();
  const { inquiries, error: inboxError, reply } = useInquiries(tab === 'inbox');
  const [filter, setFilter] = useState<Filter>('completed');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 200);
  const [openId, setOpenId] = useState<string | null>(null);
  const { detail, loading: detailLoading } = useOnboardingDetail(openId);

  // One clock per render, so every row is judged against the same "now".
  const [now] = useState(() => Date.now());

  const staged = useMemo(
    () => (onboardings ?? []).map((o) => ({ ...o, stage: onboardingStage(o.status, o.lastActivityAt ?? o.openedAt, now) })),
    [onboardings, now],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { completed: 0, started: 0, stalled: 0, invited: 0, all: staged.length };
    for (const o of staged) c[o.stage] += 1;
    return c;
  }, [staged]);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase().replace(/^@/, '');
    return staged
      .filter((o) => filter === 'all' || o.stage === filter)
      .filter(
        (o) =>
          !q ||
          o.name.toLowerCase().includes(q) ||
          o.stageName.toLowerCase().includes(q) ||
          o.telegram.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Completed: newest finish first. Everything else: most recent activity first.
        const at = (o: typeof a) => Date.parse(o.completedAt ?? o.lastActivityAt ?? o.invitedAt ?? '') || 0;
        return at(b) - at(a);
      });
  }, [staged, filter, debounced]);

  const openInbox = inquiries?.filter(needsALook).length ?? 0;
  const loading = onboardings === null;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Onboarding</h1>
            <p className="text-sm text-zinc-400">
              Approved applicants’ onboarding forms, and every email to hello@bluurock.com.
            </p>
          </div>
          {tab === 'applicants' && (
            <div className="relative w-full sm:w-64">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, @handle or email"
                aria-label="Search applicants"
                className="pl-9"
              />
            </div>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-5">
          <TabsList>
            <TabsTrigger value="applicants">Applicants</TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2">
              Inbox
              {openInbox > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {openInbox}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="applicants" className="flex flex-col gap-4">
            <FilterChips
              label="Filter by stage"
              items={FILTERS.map((f) => ({ ...f, dot: f.value === 'all' ? undefined : ONBOARDING_STAGE_META[f.value].dot }))}
              value={filter}
              counts={counts}
              onChange={setFilter}
            />

            {error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : loading ? (
              <div className={cn(SURFACE, 'flex flex-col divide-y divide-white/[0.07] rounded-xl')}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-72" />
                    </div>
                    <Skeleton className="h-8 w-36" />
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="py-8 text-sm text-zinc-400">
                {debounced.trim() ? (
                  <>
                    Nothing matches “{debounced.trim()}”.{' '}
                    <button type="button" onClick={() => setQuery('')} className="text-zinc-200 underline-offset-2 hover:underline">
                      Clear the search
                    </button>
                  </>
                ) : (
                  EMPTY[filter]
                )}
              </p>
            ) : (
              <ul className={cn(SURFACE, 'flex flex-col divide-y divide-white/[0.07] overflow-hidden rounded-xl')}>
                {visible.map((o) => (
                  <ApplicantRow key={o.id} onboarding={o} onOpen={() => setOpenId(o.id)} onResend={() => resend(o.id)} />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="inbox">
            <Inbox inquiries={inquiries} error={inboxError} onReply={reply} />
          </TabsContent>
        </Tabs>
      </div>

      <AnswersSheet
        open={openId !== null}
        onOpenChange={(next) => !next && setOpenId(null)}
        detail={detail}
        loading={detailLoading}
      />
    </AppLayout>
  );
}
