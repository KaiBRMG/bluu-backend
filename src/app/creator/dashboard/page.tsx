"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase-config";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { toast } from "sonner";
import { ChevronRight, Info, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAmount } from "@/lib/campaignTracking";
import {
  buildVerdict,
  customsByType,
  sumAmounts,
  type AgendaItem,
} from "../lib/agenda";
import { useCreatorWork } from "../lib/useCreatorWork";
import { COLOR, FOCUS_RING, PAGE_GROUND_STYLE, SURFACE, TYPE_META, URGENCY } from "../theme";
import { PortalHeader } from "../components/PortalHeader";
import { SpineEnd, SpineGroup } from "../components/Spine";
import { WorkRow, WorkRowSkeleton } from "../components/WorkRow";
import { CustomRequestDialog } from "../components/CustomRequestDialog";
import { ContentPlanDialog } from "../components/ContentPlanDialog";
import { CreatorDialog } from "../components/CreatorDialog";
import { LoadError } from "../components/LoadError";
import { EmptyState } from "../components/EmptyState";

/**
 * The creator's "Today".
 *
 * The portal used to open with two sections grouped by record type — customs in
 * one, content planning in another — which asks a creator to answer "what do I
 * owe?" by reading two lists and merging them herself. This screen merges them
 * once, on the spine, in the order the work comes due.
 *
 * Reading order is deliberate and matches the question being asked:
 *   1. the verdict — one sentence, in prose, not a metric
 *   2. the spine — overdue, today, then a graduation per upcoming day
 *   3. the customs ledger — the money view, a different shape from the stream
 *
 * Everything visible here is active work. A record the creator submits leaves
 * this screen and appears on the staff side under "Recently Completed"; see
 * `useCreatorWork`.
 */

function greeting(hour: number): string {
  if (hour < 5) return "Late one";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** A heading with an optional explanation behind an info control. The copy is
 *  long and only needed once, so it earns a popover rather than a paragraph
 *  that every creator scrolls past every day. */
function SectionHeading({
  children,
  info,
  action,
}: {
  children: React.ReactNode;
  info?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="text-sm font-semibold" style={{ color: COLOR.ink }}>
        {children}
      </h2>
      {info && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="What is this?"
              className={`relative size-6 shrink-0 after:absolute after:-inset-3 after:content-[''] ${FOCUS_RING}`}
              style={{ color: COLOR.ink2 }}
            >
              <Info className="size-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className={`max-w-xs rounded-xl text-xs leading-relaxed ${SURFACE.overlay}`}
            style={{ color: COLOR.ink2 }}
          >
            {info}
          </PopoverContent>
        </Popover>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export default function CreatorTodayPage() {
  const { creatorUser } = useCreatorAuth();
  const searchParams = useSearchParams();
  const crId = searchParams.get("crId");

  const work = useCreatorWork();
  const { visibleAgenda: agenda, loading, anyError, retry, sealing, complete, isBusy } = work;

  const [detail, setDetail] = useState<AgendaItem | null>(null);
  const [linkedError, setLinkedError] = useState<string | null>(null);
  const linkedResolved = useRef(false);

  const verdict = useMemo(() => buildVerdict(agenda), [agenda]);
  const customs = useMemo(() => agenda.all.filter((i) => i.kind === "custom"), [agenda]);
  const ledger = useMemo(() => customsByType(customs), [customs]);

  // The greeting is computed once per mount rather than off the ticking clock:
  // it is a nicety, and re-rendering "Evening" to "Late one" under someone's
  // eyes at midnight would be a distraction, not an improvement.
  const [hour] = useState(() => new Date().getHours());
  const name = creatorUser?.stageName || creatorUser?.displayName || "there";

  // ── Deep-linked custom request (?crId=) ───────────────────────────────────
  useEffect(() => {
    if (!crId || !creatorUser || loading || linkedResolved.current) return;

    const found = agenda.all.find((i) => i.kind === "custom" && i.id === crId);
    if (found) {
      linkedResolved.current = true;
      // Deferred rather than called synchronously in the effect body — same
      // reasoning as CreatorPortalShell's bootstrap: avoids a cascading render
      // from this render pass.
      queueMicrotask(() => setDetail(found));
      return;
    }

    // Not in the live set. Give the listener a moment before deciding why, then
    // say which of the three reasons it is — "nothing happened" is the one
    // outcome a creator following a link cannot act on.
    const timer = window.setTimeout(async () => {
      if (linkedResolved.current) return;
      linkedResolved.current = true;
      try {
        const snap = await getDoc(doc(db, "campaign-tracking", crId));
        if (!snap.exists()) {
          toast.error("That custom request no longer exists.");
        } else if ((snap.data() as Record<string, unknown>).creatorID !== creatorUser.creatorID) {
          setLinkedError("This request belongs to a different account.");
        } else {
          toast.info("That request isn't active right now.", {
            description: "It may already be with your manager for review.",
          });
        }
      } catch {
        toast.error("That request couldn't be loaded.");
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [crId, agenda, creatorUser, loading]);

  if (!creatorUser) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={PAGE_GROUND_STYLE}>
        <span
          className="size-6 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: COLOR.azure, borderRightColor: `${COLOR.azure}40` }}
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  const verdictHex =
    verdict.tone === "clear" ? COLOR.ink : URGENCY[verdict.tone as Exclude<typeof verdict.tone, "clear">].hex;

  return (
    <div className="min-h-dvh" style={PAGE_GROUND_STYLE}>
      <PortalHeader />

      <div className="mx-auto w-full max-w-3xl px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-12 md:pb-16">
        {/* ── The verdict ──────────────────────────────────────────────────── */}
        <section className="mb-9">
          <p className="text-sm" style={{ color: COLOR.ink2 }}>
            {greeting(hour)}, {name}
          </p>
          <h1
            className="mt-1.5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
            style={{ color: verdict.tone === "late" ? verdictHex : COLOR.ink }}
          >
            {loading ? " " : verdict.headline}
          </h1>
          <p className="mt-2 max-w-[52ch] text-sm leading-relaxed" style={{ color: COLOR.ink2 }}>
            {loading ? "Checking your schedule…" : verdict.sub}
          </p>
        </section>

        {/* ── The spine ────────────────────────────────────────────────────── */}
        <section aria-labelledby="schedule-heading" className="mb-12">
          <h2 id="schedule-heading" className="sr-only">
            Your schedule
          </h2>

          {loading ? (
            <ul className="m-0 list-none p-0">
              {[0, 1, 2, 3].map((i) => (
                <WorkRowSkeleton key={i} index={i} />
              ))}
            </ul>
          ) : anyError ? (
            <LoadError message="Couldn't load your schedule." onRetry={retry} />
          ) : agenda.groups.length === 0 ? (
            <EmptyState
              icon={PartyPopper}
              tone="done"
              title="Nothing on your plate"
              body="When your manager adds a custom request or something to your content plan, it lands here."
            />
          ) : (
            <ol className="m-0 list-none p-0">
              {agenda.groups.map((group) => (
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
                      // One-tap completion for routine content planning only.
                      // Customs are high-ticket and complete from the dialog —
                      // the difference in ceremony encodes the difference in
                      // stakes.
                      onComplete={
                        item.kind === "content" ? () => void complete(item) : undefined
                      }
                    />
                  ))}
                </SpineGroup>
              ))}
              <SpineEnd label="That's everything we've got for you." />
            </ol>
          )}
        </section>

        {/* ── The customs ledger ───────────────────────────────────────────────
            A different shape from the stream on purpose: the spine answers
            "when", this answers "how much", which is the other question a
            creator actually has about customs. Types with nothing in them are
            not rendered. */}
        {!loading && !anyError && ledger.length > 0 && (
          <section aria-labelledby="ledger-heading">
            <SectionHeading
              info="These are high-ticket custom requests your fans make. Because they are custom-made they sell far above regular content, and a fan willing to pay for one usually comes back for more — so getting them out quickly matters."
              action={
                <Link
                  href="/creator/dashboard/all-customs"
                  className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-[#131d27] ${FOCUS_RING}`}
                  style={{ color: COLOR.azureText }}
                >
                  View all <ChevronRight className="size-3.5" aria-hidden="true" />
                </Link>
              }
            >
              <span id="ledger-heading">Outstanding value</span>
            </SectionHeading>

            <div className={`overflow-hidden rounded-2xl ${SURFACE.panel}`}>
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Outstanding custom requests by type, with total value
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="sr-only">
                      Type
                    </th>
                    <th scope="col" className="sr-only">
                      Count
                    </th>
                    <th scope="col" className="sr-only">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(({ type, items }) => (
                    <tr key={type} className="border-b last:border-b-0" style={{ borderColor: COLOR.line }}>
                      <th
                        scope="row"
                        className="px-4 py-3 text-left text-sm font-medium"
                        style={{ color: COLOR.ink }}
                      >
                        {TYPE_META[type].plural}
                      </th>
                      <td className="pf-mono px-2 py-3 text-right text-xs" style={{ color: COLOR.ink2 }}>
                        {items.length}
                      </td>
                      <td
                        className="pf-mono px-4 py-3 text-right text-sm font-medium"
                        style={{ color: COLOR.ink }}
                      >
                        {formatAmount(sumAmounts(items))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: COLOR.raised }}>
                    <th
                      scope="row"
                      className="px-4 py-3 text-left text-xs font-medium"
                      style={{ color: COLOR.ink2 }}
                    >
                      Total outstanding
                    </th>
                    <td />
                    <td
                      className="pf-mono px-4 py-3 text-right text-sm font-semibold"
                      style={{ color: COLOR.ink }}
                    >
                      {formatAmount(sumAmounts(customs))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="mt-2 px-1 text-[11px] leading-relaxed" style={{ color: COLOR.ink3 }}>
              Internal tracking figures for coordination.
            </p>
          </section>
        )}
      </div>

      {/* ── Detail dialogs ─────────────────────────────────────────────────── */}
      {detail?.kind === "custom" && (
        <CustomRequestDialog
          item={detail}
          open
          onOpenChange={(o) => !o && setDetail(null)}
          driveLink={creatorUser.driveLink}
          todayKey={agenda.todayKey}
          busy={isBusy(detail.key)}
          onComplete={() => {
            void complete(detail);
            setDetail(null);
          }}
        />
      )}

      {detail?.kind === "content" && (
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

      <CreatorDialog
        open={!!linkedError}
        onOpenChange={(o) => !o && setLinkedError(null)}
        title="Can't open this request"
        description="This custom request cannot be shown on this account."
        className="sm:max-w-sm"
      >
        <p className="text-sm" style={{ color: COLOR.ink2 }}>
          {linkedError}
        </p>
      </CreatorDialog>
    </div>
  );
}
