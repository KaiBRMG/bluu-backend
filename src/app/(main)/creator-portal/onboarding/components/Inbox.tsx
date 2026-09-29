'use client';

import { useMemo, useState } from 'react';
import { IconMailForward } from '@tabler/icons-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import type { InquiryOutcome, InquirySummary } from '@/types/creatorOnboarding';
import { FilterChips } from './FilterChips';

/**
 * What happened to each email, as a closed vocabulary with a hue each —
 * borrowed from the house status triad: green is done, orange waits on a
 * person, red failed, zinc is inert.
 */
const OUTCOME_META: Record<InquiryOutcome, { label: string; classes: string }> = {
  replied: { label: 'Replied', classes: 'text-green-400 bg-green-500/10 border-green-500/30' },
  held: { label: 'Held for you', classes: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  'rate-limited': { label: 'Held — busy hour', classes: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  failed: { label: 'Send failed', classes: 'text-red-400 bg-red-500/10 border-red-500/30' },
  spam: { label: 'Spam', classes: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
  system: { label: 'Automated', classes: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
  duplicate: { label: 'Already answered', classes: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
};

/** The rows a person should look at: anything the app did not settle on its own. */
export function needsALook(q: InquirySummary): boolean {
  return !q.repliedAt && (q.outcome === 'held' || q.outcome === 'failed' || q.outcome === 'rate-limited');
}

type Filter = 'look' | 'replied' | 'filtered' | 'all';

const FILTERS: { value: Filter; label: string; match: (q: InquirySummary) => boolean }[] = [
  { value: 'look', label: 'Needs a look', match: needsALook },
  { value: 'replied', label: 'Replied', match: (q) => q.outcome === 'replied' },
  { value: 'filtered', label: 'Filtered out', match: (q) => q.outcome === 'spam' || q.outcome === 'system' || q.outcome === 'duplicate' },
  { value: 'all', label: 'All', match: () => true },
];

const EMPTY: Record<Filter, string> = {
  look: 'Nothing waiting. Every enquiry was either answered or filtered out.',
  replied: 'No replies sent yet.',
  filtered: 'Nothing has been filtered out.',
  all: 'No email has arrived yet. Once hello@ forwards to the app, every message shows up here.',
};

/** Linkifies bare URLs — Gmail's forwarding confirmation is only useful if its link is clickable. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-[#3b82f6] underline-offset-2 hover:underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Every email hello@bluurock.com received, and what the rules filter did.
 *
 * The filter only answers mail it is sure about, so this tab is where the
 * judgement calls come back to a person: "Needs a look" is the default, and
 * each held message carries the filter's reasons and a one-click reply. The
 * reasons are shown on every row — a filter nobody can see into is a filter
 * nobody can trust or tune.
 */
export function Inbox({
  inquiries,
  error,
  onReply,
}: {
  inquiries: InquirySummary[] | null;
  error: string | null;
  onReply: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('look');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.value] = (inquiries ?? []).filter(f.match).length;
    return out;
  }, [inquiries]);

  const visible = useMemo(
    () => (inquiries ?? []).filter(FILTERS.find((f) => f.value === filter)!.match),
    [inquiries, filter],
  );

  return (
    <div className="flex flex-col gap-4">
      <FilterChips label="Filter the inbox" items={FILTERS} value={filter} counts={counts} onChange={setFilter} />

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : inquiries === null ? (
        <div className={cn(SURFACE, 'flex flex-col divide-y divide-white/[0.07] rounded-xl')}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 px-4 py-3.5">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-full max-w-lg" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-sm text-zinc-400">{EMPTY[filter]}</p>
      ) : (
        <ul className={cn(SURFACE, 'flex flex-col divide-y divide-white/[0.07] overflow-hidden rounded-xl')}>
          {visible.map((q) => {
            const meta = OUTCOME_META[q.outcome] ?? OUTCOME_META.held;
            const canReply = !q.repliedAt && !!q.replyTo && q.outcome !== 'system' && q.outcome !== 'duplicate';
            const open = expanded === q.id;
            return (
              <li key={q.id} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-white">{q.name || q.replyTo || q.from}</span>
                      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.classes)}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-zinc-400 tabular-nums">
                      <span>{q.replyTo ?? q.from}</span>
                      <span aria-hidden>·</span>
                      <span title={new Date(q.receivedAt).toLocaleString()}>
                        {formatDistanceToNowStrict(new Date(q.receivedAt), { addSuffix: true })}
                      </span>
                      {q.viaContactForm && (
                        <>
                          <span aria-hidden>·</span>
                          <span>via website form</span>
                        </>
                      )}
                      {q.repliedAt && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            replied {formatDistanceToNowStrict(new Date(q.repliedAt), { addSuffix: true })}
                            {q.repliedByName ? ` by ${q.repliedByName}` : ' automatically'}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {canReply && (
                    <Button size="sm" variant="outline" onClick={() => onReply(q.id)} className="h-8 shrink-0 gap-1.5">
                      <IconMailForward className="size-4" aria-hidden />
                      Send reply
                    </Button>
                  )}
                </div>

                {q.subject && <p className="text-sm font-medium text-zinc-200">{q.subject}</p>}
                {/* Text and toggle are separate: the snippet can hold links, and a
                    link inside a button is two targets fighting for one click. */}
                <p className={cn('max-w-[75ch] text-sm leading-relaxed whitespace-pre-wrap text-zinc-400', !open && 'line-clamp-2')}>
                  <Linkified text={q.snippet} />
                </p>
                {q.snippet.length > 160 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : q.id)}
                    aria-expanded={open}
                    className="self-start rounded-sm text-xs font-medium text-zinc-300 underline-offset-2 hover:text-white hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {open ? 'Show less' : 'Show the whole message'}
                  </button>
                )}

                {q.reasons.length > 0 && (
                  <p className="text-[11px] text-zinc-400">
                    <span className="text-zinc-300">Why:</span> {q.reasons.join(' · ')}
                  </p>
                )}
                {q.error && <p className="text-[11px] text-red-400">{q.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
