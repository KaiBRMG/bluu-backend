'use client';

import { RotateCcw } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { AttrChip, FanLabel } from '@/components/buddyx/buddyxUi';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatSaleDateTime, formatUsd } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import { SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { daysAgo } from '@/lib/buddyx/analyticsFormat';
import type { FanDetail } from '@/lib/buddyx/analyticsTypes';

const SUB_TYPE: Record<string, string> = {
  new_subscriber: 'New subscriber',
  returning_subscriber: 'Returning subscriber',
  new_subscriber_trial: 'Free trial',
};

/**
 * One fan, in a side panel — the collection stays on screen behind it, so
 * opening a fan is a peek rather than a departure (DESIGN.md §5).
 *
 * Purchases span both sources with the cutover marked, because a fan's history
 * runs straight through it. "Earned by" names agents only for an admin; an
 * agent sees "You" and "Team".
 */
export function FanDrawer({
  creatorId,
  fanId,
  timezone,
  onOpenChange,
}: {
  creatorId: string | null;
  fanId: string | null;
  timezone: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(creatorId && fanId);
  const url = open ? `/api/analytics/fans/${encodeURIComponent(creatorId!)}/${encodeURIComponent(fanId!)}` : null;
  const { data, loading, error, reload } = useBuddyxAnalytics<FanDetail>(url);
  const detail = data && data.fan.fanId === fanId && data.fan.creatorId === creatorId ? data : null;

  // Purchases are newest first; the first one at or before the cutover gets the marker.
  const cutoverIndex = detail ? detail.purchases.findIndex(p => Date.parse(p.occurredAt) <= SALES_CUTOVER_AT) : -1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{detail ? <FanLabel name={detail.fan.name} fanId={detail.fan.fanId} /> : 'Fan'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {creatorId && <CreatorChip creatorId={creatorId} size="xs" />}
            {fanId && <span className="font-mono text-xs">{fanId}</span>}
            {detail?.isStacker && <AttrChip>Stacker</AttrChip>}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {loading && !detail ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          ) : error && !detail ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void reload(true)}>
                <RotateCcw className="size-3.5" aria-hidden /> Try again
              </Button>
            </div>
          ) : detail ? (
            <>
              <dl className="grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-xs text-zinc-400">Lifetime gross</dt>
                  <dd className="text-lg font-semibold tabular-nums">{formatUsd(detail.fan.lifetimeSpend)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Tips / PPV (gross)</dt>
                  <dd className="text-sm tabular-nums">{formatUsd(detail.fan.lifetimeTips)} / {formatUsd(detail.fan.lifetimePpv)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Last purchase</dt>
                  <dd className="text-sm">{daysAgo(detail.fan.lastPurchaseAt)}</dd>
                </div>
              </dl>

              <section>
                <h3 className="text-xs font-semibold text-zinc-400">Acquired through</h3>
                <p className="mt-1 text-sm">
                  {detail.acquisition
                    ? `${detail.acquisition.kind === 'free-trial' ? 'Free-trial link' : 'Tracking link'} · ${detail.acquisition.linkName ?? detail.acquisition.linkId}`
                    : 'No link on record'}
                  {detail.linkTotalSpent !== null && detail.linkTotalSpent > 0 && (
                    <span className="text-zinc-400" title="As BuddyX reports it for the link — its API does not say whether this is gross or net."> · {formatUsd(detail.linkTotalSpent)} spent per the link</span>
                  )}
                </p>
              </section>

              {detail.earnedBy.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-zinc-400">Earned by · gross</h3>
                  <ul className="mt-1 space-y-0.5">
                    {detail.earnedBy.map(e => (
                      <li key={e.label} className="flex justify-between text-sm">
                        <span>{e.label}</span>
                        <span className="tabular-nums">{formatUsd(e.gross)} <span className="text-[11px] text-zinc-400">· {e.count}</span></span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="text-xs font-semibold text-zinc-400">Purchases · gross</h3>
                {detail.purchases.length === 0 ? (
                  <p className="mt-1 text-sm text-zinc-400">No purchases on record.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-white/[0.07]">
                    {detail.purchases.map((p, index) => {
                      const crossing = index === cutoverIndex && index > 0;
                      return (
                        <li key={p.saleId} className="py-1.5">
                          {crossing && <p className="pb-1 text-[11px] text-zinc-400">Infloww history — before 08:50 on 4 Oct</p>}
                          <div className="flex items-center gap-2 text-sm">
                            <span className="w-28 shrink-0 tabular-nums text-zinc-400">{formatSaleDateTime(p.occurredAt, timezone)}</span>
                            <AttrChip>{saleTypeLabel(p.type)}</AttrChip>
                            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{p.earnedBy ?? 'Unassigned'}</span>
                            <span className="tabular-nums">{formatUsd(p.gross)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {detail.subscriptions.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-zinc-400">Subscriptions</h3>
                  <ul className="mt-1 divide-y divide-white/[0.07]">
                    {detail.subscriptions.map(s => (
                      <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span>{SUB_TYPE[s.subType ?? ''] ?? s.subType ?? 'Subscribed'}</span>
                        <span className="tabular-nums text-zinc-400">
                          {s.at ? formatSaleDateTime(s.at, timezone) : '—'}
                          {s.priceGross > 0 && ` · ${formatUsd(s.priceGross)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
