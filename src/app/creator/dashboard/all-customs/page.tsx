"use client";

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import { formatAmount } from "@/lib/campaignTracking";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { customsByType, sumAmounts, type AgendaItem } from "../../lib/agenda";
import { useCreatorWork } from "../../lib/useCreatorWork";
import { COLOR, PAGE_GROUND_STYLE, TYPE_META } from "../../theme";
import { PortalHeader } from "../../components/PortalHeader";
import { SpineEnd, SpineGroup } from "../../components/Spine";
import { WorkRow, WorkRowSkeleton } from "../../components/WorkRow";
import { CustomRequestDialog } from "../../components/CustomRequestDialog";
import { LoadError } from "../../components/LoadError";
import { EmptyState } from "../../components/EmptyState";

/**
 * Every outstanding custom request, grouped by type.
 *
 * **The creator only ever sees `In Progress` customs** — the query and
 * `selectVisibleCustoms` both enforce it. Submitting one moves it to *Awaiting
 * Approval*, at which point it leaves this list and appears on the staff side
 * under "Recently Completed". That is the intended flow: this page is her
 * outstanding work, not an archive of everything she has ever done.
 *
 * It shares the spine with the dashboard rather than inventing a second row
 * vocabulary; what differs is the **grouping** (by type, not by day) and the
 * **money** — which is the other question a creator has about customs and the
 * one the dashboard's time-ordered stream cannot answer.
 *
 * There is no pagination. With completed work excluded the set is small, and a
 * pager on a phone costs a tap per page to hide records that would have fit in
 * a scroll.
 */
export default function CustomRequestsPage() {
  const { creatorUser } = useCreatorAuth();
  const { visibleAgenda: agenda, loading, customsError, retry, sealing, complete, isBusy } =
    useCreatorWork();

  const [detail, setDetail] = useState<AgendaItem | null>(null);

  const customs = useMemo(() => agenda.all.filter((i) => i.kind === "custom"), [agenda]);
  const groups = useMemo(() => customsByType(customs), [customs]);
  const total = useMemo(() => sumAmounts(customs), [customs]);

  return (
    <div className="min-h-dvh" style={PAGE_GROUND_STYLE}>
      <PortalHeader title="Custom Requests" />

      <div className="mx-auto w-full max-w-3xl px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 md:pb-16">
        <header className="mb-9">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: COLOR.ink }}>
            Custom requests
          </h1>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed" style={{ color: COLOR.ink2 }}>
            {loading
              ? "Loading your custom requests…"
              : customs.length === 0
                ? "Everything your fans have ordered will show up here."
                : `${customs.length} outstanding, worth ${formatAmount(total)} in total.`}
          </p>
        </header>

        {loading ? (
          <ul className="m-0 list-none p-0">
            {[0, 1, 2].map((i) => (
              <WorkRowSkeleton key={i} index={i} />
            ))}
          </ul>
        ) : customsError ? (
          <LoadError message="Couldn't load your custom requests." onRetry={retry} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Inbox}
            tone="done"
            title="No custom requests right now"
            body="When a fan orders a custom, a call or an item, it appears here with its deadline and value."
          />
        ) : (
          <ol className="m-0 list-none p-0">
            {groups.map(({ type, items }) => (
              <SpineGroup
                key={type}
                label={TYPE_META[type].plural}
                // The group's own value, in the slot the dashboard's spine uses
                // for a date — this axis is grouped by type, so its second fact
                // is money rather than a day.
                sub={formatAmount(sumAmounts(items))}
                bucket="later"
                count={items.length}
              >
                {items.map((item, i) => (
                  <WorkRow
                    key={item.key}
                    item={item}
                    index={i}
                    todayKey={agenda.todayKey}
                    sealing={sealing.has(item.key)}
                    busy={isBusy(item.key)}
                    onOpen={() => setDetail(item)}
                    // No one-tap action: customs are high-ticket and are
                    // submitted deliberately, from the dialog.
                  />
                ))}
              </SpineGroup>
            ))}
            <SpineEnd label={`${customs.length} outstanding in total.`} />
          </ol>
        )}
      </div>

      {detail && (
        <CustomRequestDialog
          item={detail}
          open
          onOpenChange={(o) => !o && setDetail(null)}
          driveLink={creatorUser?.driveLink}
          todayKey={agenda.todayKey}
          busy={isBusy(detail.key)}
          onComplete={() => {
            void complete(detail);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}
