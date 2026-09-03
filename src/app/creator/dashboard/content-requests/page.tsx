"use client";

import { useMemo, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { type AgendaItem } from "../../lib/agenda";
import { useCreatorWork } from "../../lib/useCreatorWork";
import { COLOR, PAGE_GROUND_STYLE } from "../../theme";
import { PortalHeader } from "../../components/PortalHeader";
import { SpineEnd, SpineGroup } from "../../components/Spine";
import { WorkRow, WorkRowSkeleton } from "../../components/WorkRow";
import { ContentPlanDialog } from "../../components/ContentPlanDialog";
import { LoadError } from "../../components/LoadError";
import { EmptyState } from "../../components/EmptyState";

/**
 * The content plan — everything outstanding, in the order it is due.
 *
 * **The creator only ever sees `Outstanding` content** — the query and
 * `selectVisibleContent` both enforce it. Submitting an item moves it to
 * *Completed*, at which point it leaves this list and appears on the staff side
 * under "Recently Completed".
 *
 * ── Completion here is undoable, and that is new ─────────────────────────────
 * This page used to send no `revert` flag and offer no way back, while the
 * dashboard's identical action was fully undoable — the same record behaving
 * differently depending on which screen you tapped it from. Both now run
 * through the one mutation in `useCreatorWork`, which carries the Undo.
 *
 * Because completed items are no longer listed, the undo is the toast rather
 * than a persistent "mark as incomplete" row action. If a creator misses the
 * toast, the record is with her manager — which is exactly what the copy on the
 * submit action says will happen.
 */
export default function ContentPlanPage() {
  const { visibleAgenda: agenda, loading, contentError, retry, sealing, complete, isBusy } =
    useCreatorWork();

  const [detail, setDetail] = useState<AgendaItem | null>(null);

  // Only the content half of the agenda, keeping the day grouping the spine
  // already computed rather than regrouping and risking a different answer.
  const groups = useMemo(
    () =>
      agenda.groups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.kind === "content") }))
        .filter((g) => g.items.length > 0),
    [agenda],
  );
  const count = useMemo(() => agenda.all.filter((i) => i.kind === "content").length, [agenda]);
  const lateCount = useMemo(
    () => agenda.all.filter((i) => i.kind === "content" && i.urgency === "late").length,
    [agenda],
  );

  return (
    <div className="min-h-dvh" style={PAGE_GROUND_STYLE}>
      <PortalHeader title="Content Plan" />

      <div className="mx-auto w-full max-w-3xl px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 md:pb-16">
        <header className="mb-9">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: COLOR.ink }}>
            Content plan
          </h1>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed" style={{ color: COLOR.ink2 }}>
            {loading
              ? "Loading your content plan…"
              : count === 0
                ? "This is the content we need to keep your page running. Nothing is outstanding right now."
                : lateCount > 0
                  ? `${count} outstanding, ${lateCount} of them past due. Tap the tick to send one for review.`
                  : `${count} outstanding. Tap the tick to send one for review.`}
          </p>
        </header>

        {loading ? (
          <ul className="m-0 list-none p-0">
            {[0, 1, 2].map((i) => (
              <WorkRowSkeleton key={i} index={i} />
            ))}
          </ul>
        ) : contentError ? (
          <LoadError message="Couldn't load your content plan." onRetry={retry} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            tone="done"
            title="Content plan is clear"
            body="We follow a strict upload schedule, so new requirements appear here as soon as your manager schedules them."
          />
        ) : (
          <ol className="m-0 list-none p-0">
            {groups.map((group) => (
              <SpineGroup
                key={group.id}
                label={group.label}
                sub={group.sub}
                bucket={group.bucket}
                count={group.items.length}
                isToday={group.id === agenda.todayKey}
              >
                {group.items.map((item, i) => (
                  <WorkRow
                    key={item.key}
                    item={item}
                    index={i}
                    todayKey={agenda.todayKey}
                    sealing={sealing.has(item.key)}
                    busy={isBusy(item.key)}
                    onOpen={() => setDetail(item)}
                    onComplete={() => void complete(item)}
                  />
                ))}
              </SpineGroup>
            ))}
            <SpineEnd label={`${count} outstanding in total.`} />
          </ol>
        )}
      </div>

      {detail && (
        <ContentPlanDialog
          item={detail}
          open
          onOpenChange={(o) => !o && setDetail(null)}
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
