'use client';

/**
 * File a dispute — v2: claim specific tips, found by search.
 *
 * An approved dispute now *moves the sale* inside Bluu Backend (BuddyX is
 * read-only), so the agent no longer types a sale's details; they pick the
 * tips themselves. The search is deliberately narrow (D6): one creator, a
 * window of at most 7 days, tips only, no totals.
 *
 * **Selection persists across filter changes** — tips from two creators can go
 * into one claim. That is the opposite call from the admin bulk bar, and it is
 * deliberate: here the selection *is* the claim being built, not an action on
 * the rows in view. The footer shows it whole, with the split it will become
 * (one dispute per current holder, D5).
 *
 * A refused submission (a tip locked by someone else a moment ago) keeps the
 * dialog open with those rows marked in words. Nothing typed is lost.
 */

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2Icon, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { useAuth } from '@/components/AuthProvider';
import { useBuddyxCreators } from '@/hooks/useBuddyxSync';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { CreatorCombobox } from '@/components/buddyx/CreatorCombobox';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { AttrChip, FanLabel, InfoTip, PPV_ATTRIBUTION, TIPS_ATTRIBUTION } from '@/components/buddyx/buddyxUi';
import { PersonTag } from './disputeUi';
import { formatSaleDateTime, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import { MAX_DISPUTE_SALES } from '@/lib/disputes/disputeRules';
import { cn } from '@/lib/utils';

const COMMENT_MAX = 2000;
const MAX_WINDOW_DAYS = 7;

interface SearchRow {
  saleId: string;
  occurredAt: string;
  type: string;
  gross: number;
  fanId: string;
  fanName: string;
  holder: { uid: string; displayName: string } | null;
  disputed: boolean;
  finalised: boolean;
}

type Picked = SearchRow & { creatorId: string };

interface CreateDisputeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  /** Runs after a successful submission (the column refetches). */
  onSubmitted?: () => void | Promise<void>;
}

/** "1 dispute to Queen (2 tips), 1 to admin (unassigned)" — the split D5 will make. */
function describeSplit(groups: Array<{ label: string; count: number }>): string {
  return groups
    .map((g, i) => `${i === 0 ? '1 dispute' : '1'} to ${g.label}${groups.length > 1 ? ` (${pluralise(g.count, 'tip')})` : ''}`)
    .join(', ');
}

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

export function CreateDisputeDialog({ open, onOpenChange, timezone, onSubmitted }: CreateDisputeDialogProps) {
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const mappedCreatorIds = useBuddyxCreators();

  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [from, setFrom] = useState<Date | undefined>(() => new Date());
  const [to, setTo] = useState<Date | undefined>(() => new Date());
  const [fanId, setFanId] = useState('');

  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [refused, setRefused] = useState<Map<string, string>>(new Map());
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fanNeedle = fanId.trim();
  const visibleRows = rows && fanNeedle ? rows.filter(r => r.fanId === fanNeedle) : rows;

  const windowDays = from && to ? daysBetween(from, to) : 0;
  const windowError =
    from && to && to < from ? 'The end is before the start.' : windowDays > MAX_WINDOW_DAYS ? `At most ${MAX_WINDOW_DAYS} days.` : null;

  // ── Search ── (by creator and window only; the fan filter is applied to the
  // rows in hand, so typing a fan id costs no request)
  useEffect(() => {
    if (!open || !user || !creatorId || !from || !to || windowError) {
      setRows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ creatorId, from: dayKey(from), to: dayKey(to) });
        const body = await authFetch(`/api/ca-sales/search?${params}`);
        if (!cancelled) {
          setRows(body.rows ?? []);
          setTruncated(body.truncated === true);
        }
      } catch (err) {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, authFetch, creatorId, from, to, windowError, retryKey]);

  const toggle = (row: SearchRow, on: boolean) => {
    setPicked(prev => {
      const next = new Map(prev);
      if (on && creatorId) next.set(row.saleId, { ...row, creatorId });
      else next.delete(row.saleId);
      return next;
    });
  };

  // ── The split preview: one dispute per current holder ──
  const selection = [...picked.values()];
  const split = useMemo(() => {
    const groups = new Map<string, { label: string; count: number }>();
    for (const row of picked.values()) {
      const key = row.holder?.uid ?? '__none__';
      const g = groups.get(key) ?? { label: row.holder ? row.holder.displayName || 'a former agent' : 'admin (unassigned)', count: 0 };
      g.count += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [picked]);
  const selectedGross = selection.reduce((s, r) => s + r.gross, 0);

  const reset = () => {
    setPicked(new Map());
    setRefused(new Map());
    setComment('');
    setCommentError(null);
    setSubmitError(null);
    setFanId('');
  };

  async function submit() {
    if (!user) return;
    const text = comment.trim();
    if (!text) {
      setCommentError('Say why these tips are yours — it is the whole basis of the decision.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleIds: selection.map(r => r.saleId), Comment: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.refused)) {
          setRefused(new Map(body.refused.map((r: { saleId: string; label: string }) => [r.saleId, r.label])));
        }
        setSubmitError(body.error ?? `Could not file the dispute (${res.status})`);
        return;
      }
      const count = Array.isArray(body.disputes) ? body.disputes.length : 1;
      toast.success(count === 1 ? 'Dispute submitted' : `${count} disputes submitted — one per agent holding a tip`);
      reset();
      onOpenChange(false);
      await onSubmitted?.();
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && !submitting) setSubmitError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New dispute</DialogTitle>
          <DialogDescription>
            Find the tips that should be yours. An admin&apos;s approval moves them to your sales report.
          </DialogDescription>
        </DialogHeader>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-zinc-400">Creator</Label>
            <CreatorCombobox value={creatorId} onChange={setCreatorId} allowedIds={mappedCreatorIds} placeholder="Pick a creator" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-zinc-400">From</Label>
            <DatePicker value={from} onChange={setFrom} className="h-8 w-40 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-zinc-400">To</Label>
            <DatePicker value={to} onChange={setTo} className="h-8 w-40 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispute-fan" className="text-xs text-zinc-400">Fan ID (optional)</Label>
            <Input
              id="dispute-fan"
              value={fanId}
              onChange={e => setFanId(e.target.value.replace(/\D/g, ''))}
              className="h-8 w-32 font-mono text-xs"
              inputMode="numeric"
            />
          </div>
        </div>
        <p className={cn('-mt-1 text-[11px]', windowError ? 'text-red-400' : 'text-zinc-400')}>
          {windowError ?? `Search up to ${MAX_WINDOW_DAYS} days at a time, this month or last. Days are in SAST.`}
        </p>

        {/* ── Results ── */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          Tips <InfoTip text={TIPS_ATTRIBUTION} /> · amounts are gross
        </div>
        <div
          tabIndex={0}
          role="region"
          aria-label="Tips found, scrollable"
          className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {!creatorId ? (
            <p className="p-3 text-sm text-zinc-400">Pick a creator and a day to find tips.</p>
          ) : searching && !rows ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
            </div>
          ) : searchError ? (
            <div className="flex items-center gap-3 p-3">
              <p className="text-sm text-red-400">{searchError}</p>
              <Button size="xs" variant="outline" onClick={() => setRetryKey(k => k + 1)}>
                <RotateCcw className="size-3" aria-hidden /> Try again
              </Button>
            </div>
          ) : visibleRows && visibleRows.length === 0 ? (
            <p className="p-3 text-sm text-zinc-400">
              No tips {fanNeedle ? `from fan ${fanNeedle} ` : ''}from this creator between {from && format(from, 'd MMM')} and {to && format(to, 'd MMM')}, other than your own.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.07]">
              {(visibleRows ?? []).map(row => {
                const reason = refused.get(row.saleId) ?? (row.disputed ? 'Disputed' : row.finalised ? 'Finalised month' : null);
                const checked = picked.has(row.saleId);
                const disabled = reason !== null && !checked;
                const id = `tip-${row.saleId}`;
                return (
                  <li key={row.saleId} className={cn('flex items-center gap-3 px-3 py-2 text-sm', checked && 'bg-action-blue/[0.10]')}>
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={v => toggle(row, v === true)}
                      aria-label={`Claim the ${formatUsd(row.gross)} tip at ${formatSaleDateTime(row.occurredAt, timezone)}`}
                      className="data-[state=checked]:border-[#2563eb] data-[state=checked]:bg-[#2563eb] data-[state=checked]:text-white"
                    />
                    <label htmlFor={id} className="w-28 shrink-0 tabular-nums text-zinc-400">
                      {formatSaleDateTime(row.occurredAt, timezone)}
                    </label>
                    <AttrChip>{saleTypeLabel(row.type)}</AttrChip>
                    <FanLabel name={row.fanName} fanId={row.fanId} className="min-w-0 flex-1" />
                    <span className="w-28 shrink-0 truncate text-xs">
                      {row.holder ? <PersonTag name={row.holder.displayName} photoURL={null} size="sm" /> : <span className="text-zinc-400">Unassigned</span>}
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums">{formatUsd(row.gross)}</span>
                    <span className={cn('w-28 shrink-0 text-right text-[11px]', refused.has(row.saleId) ? 'text-orange-400' : 'text-zinc-400')}>
                      {reason ?? ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            PPVs aren&apos;t listed <InfoTip text={PPV_ATTRIBUTION} />
          </span>
          {truncated && <span>Showing the first 500 — narrow the window to see the rest.</span>}
        </div>

        {/* ── The claim being built ── */}
        {selection.length > 0 && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
            <p className="text-xs font-medium text-zinc-300">Your claim</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {selection.map(row => (
                <li key={row.saleId} className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] py-0.5 pl-1.5 pr-0.5 text-xs">
                  <CreatorChip creatorId={row.creatorId} size="xs" avatarOnly />
                  <span className="tabular-nums">{formatUsd(row.gross)}</span>
                  {refused.has(row.saleId) && <span className="text-orange-400">· {refused.get(row.saleId)}</span>}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 text-zinc-400"
                    aria-label={`Remove the ${formatUsd(row.gross)} tip from the claim`}
                    onClick={() => toggle(row, false)}
                  >
                    <X className="size-3" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dispute-comment" className="text-xs text-zinc-400">Why are these yours?</Label>
          <Textarea
            id="dispute-comment"
            value={comment}
            maxLength={COMMENT_MAX}
            onChange={e => {
              setComment(e.target.value);
              if (commentError) setCommentError(null);
            }}
            rows={3}
            aria-invalid={commentError ? true : undefined}
            placeholder="I was on shift with this fan — they tipped after my PPV at 14:10."
          />
          {commentError && <p role="alert" className="text-xs text-red-400">{commentError}</p>}
        </div>

        {submitError && <p role="alert" className="text-sm text-red-400">{submitError}</p>}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-xs text-zinc-400" aria-live="polite">
            {selection.length === 0
              ? `Pick up to ${MAX_DISPUTE_SALES} tips.`
              : `${pluralise(selection.length, 'tip')} · ${formatUsd(selectedGross)} gross → ${describeSplit(split)}`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={submitting || selection.length === 0 || selection.length > MAX_DISPUTE_SALES}
            >
              {submitting && <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />}
              Submit dispute
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
