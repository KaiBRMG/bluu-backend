'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SURFACE } from '@/lib/surfaces';
import { STATUS_DOT } from '@/lib/campaignTracking';
import type { AttentionItem, AttentionTarget, AttentionTier, OverviewPerson } from '@/lib/shiftOverview';
import { PersonAvatar, ToneDot } from './personUi';

/**
 * Dismissals are per admin, per browser: a dismissed line means "I've seen this",
 * not "this is resolved for everyone". Each one expires after two days, which
 * outlives every item in the queue (the oldest look back to yesterday).
 * Storage can throw or come back empty (private window, cleared data) — the
 * queue then simply shows everything, which is the safe failure.
 */
const DISMISS_KEY = 'bluu_shift_attention_dismissed_v1';
const DISMISS_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const DISMISS_EVENT = 'bluu:shift-attention-dismissed';

function readRaw(): string {
  try {
    return window.localStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
}

function parseDismissed(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, exp]) => exp > now));
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, number>) {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the change is lost, the queue shows everything */
  }
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

/** Another window (a second admin tab) or this one writing re-reads the store. */
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
}

const GROUPS: Array<{ tier: AttentionTier; label: string }> = [
  { tier: 'now', label: 'Right now' },
  { tier: 'earlier', label: 'Records to review' },
];

const TARGET_VERB: Record<AttentionTarget, string> = {
  timeline: 'Open timesheet',
  screenshots: 'See screenshots',
  shifts: 'Open shifts',
};

interface AttentionQueueProps {
  items: AttentionItem[];
  people: Map<string, OverviewPerson>;
  loading: boolean;
  /** One-line all-clear context, e.g. "11 working · 18 scheduled today". */
  clearContext: string;
  onOpen: (uid: string, target: AttentionTarget, date: string) => void;
}

export function AttentionQueue({ items, people, loading, clearContext, onOpen }: AttentionQueueProps) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const dismissed = useMemo(() => parseDismissed(raw), [raw]);
  const [showDismissed, setShowDismissed] = useState(false);

  const dismiss = useCallback((item: AttentionItem, name: string) => {
    writeDismissed({ ...parseDismissed(readRaw()), [item.id]: Date.now() + DISMISS_TTL_MS });
    toast.success(`Hidden: ${name} — ${item.title.toLowerCase()}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const restored = parseDismissed(readRaw());
          delete restored[item.id];
          writeDismissed(restored);
        },
      },
    });
  }, []);

  const visible = useMemo(
    () => items.filter(i => showDismissed || !dismissed[i.id]),
    [items, dismissed, showDismissed],
  );
  const openCount = items.filter(i => !dismissed[i.id]).length;
  const hiddenCount = items.length - openCount;

  return (
    <section aria-labelledby="attention-title" className={`rounded-xl ${SURFACE}`}>
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <h2 id="attention-title" className="text-sm font-semibold">Needs attention</h2>
        {!loading && openCount > 0 && (
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-200">
            {openCount}
          </span>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDismissed(v => !v)}
            aria-pressed={showDismissed}
            className="ml-auto text-xs text-zinc-400 underline-offset-2 hover:text-white hover:underline"
          >
            {showDismissed ? 'Hide dismissed' : `${hiddenCount} dismissed`}
          </button>
        )}
      </header>

      {loading ? (
        <div className="space-y-1 px-2 pb-3" aria-hidden>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-6 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-56" />
                <Skeleton className="h-3 w-80 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex items-start gap-2.5 px-4 pb-5">
          <span aria-hidden className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${STATUS_DOT.Completed}`} />
          <div>
            <p className="text-sm">{items.length === 0 ? 'Nothing needs a look.' : 'Nothing new — everything here is dismissed.'}</p>
            {items.length === 0 && (
              <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">{clearContext}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="pb-2">
          {GROUPS.map(({ tier, label }) => {
            const groupItems = visible.filter(i => i.tier === tier);
            return groupItems.length > 0 && (
              <QueueGroup key={tier} label={label} items={groupItems} people={people} dismissed={dismissed} onOpen={onOpen} onDismiss={dismiss} />
            );
          })}
        </div>
      )}
    </section>
  );
}

function QueueGroup({
  label,
  items,
  people,
  dismissed,
  onOpen,
  onDismiss,
}: {
  label: string;
  items: AttentionItem[];
  people: Map<string, OverviewPerson>;
  dismissed: Record<string, number>;
  onOpen: AttentionQueueProps['onOpen'];
  onDismiss: (item: AttentionItem, name: string) => void;
}) {
  return (
    <div>
      {/* Section rail: label, hairline, count (DESIGN.md — faceted index). */}
      <div className="flex items-center gap-3 px-4 pt-2 pb-1.5">
        <span className="text-xs font-semibold text-zinc-400">{label}</span>
        <span aria-hidden className="h-px flex-1 bg-white/[0.07]" />
        <span className="text-xs tabular-nums text-zinc-400">{items.length}</span>
      </div>
      <ul className="px-2">
        {items.map(item => {
          const person = people.get(item.userId);
          const name = person?.displayName ?? 'Unknown user';
          const isDismissed = !!dismissed[item.id];
          return (
            <li
              key={item.id}
              className={`group relative flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-[120ms] hover:bg-white/[0.055] focus-within:bg-white/[0.055] ${isDismissed ? 'opacity-60' : ''}`}
            >
              {/* The whole row opens the record; the action lane sits above it. */}
              <button
                type="button"
                onClick={() => onOpen(item.userId, item.target, item.date)}
                aria-label={`${name}: ${item.title}. ${TARGET_VERB[item.target]}`}
                className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              />
              <PersonAvatar displayName={name} photoURL={person?.photoURL} className="pointer-events-none" />
              <div className="pointer-events-none min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <ToneDot tone={item.tone} />
                  <span className="truncate">
                    <span className="font-medium text-white">{name}</span>
                    <span className="text-zinc-400"> · </span>
                    <span className="text-zinc-200">{item.title}</span>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400 tabular-nums">{item.detail}</p>
              </div>
              <div className="relative flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100">
                {/* A label, not a second button: the row's overlay already opens this. */}
                <span aria-hidden className="pointer-events-none px-2 text-xs text-zinc-300">
                  {TARGET_VERB[item.target]}
                </span>
                {!isDismissed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-zinc-400 hover:text-white"
                        aria-label={`Dismiss for me: ${name}, ${item.title}`}
                        onClick={() => onDismiss(item, name)}
                      >
                        <X />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Dismiss for me</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
