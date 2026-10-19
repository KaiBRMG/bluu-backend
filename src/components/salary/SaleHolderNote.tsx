'use client';

/**
 * Whether Bluu Backend holds a sale where BuddyX credits it — and, when not,
 * why. One component for the admin ledger (CA Admin → Sales) and the agent's
 * Sales Report, so the two can never describe the same row differently.
 *
 * Bluu Backend is the source of truth for sales: an approved dispute or an
 * admin reassignment moves a sale here, and no sync undoes it. That makes a
 * row that disagrees with BuddyX *normal*, not an error — but never silent.
 * The pill names the cause in words (`Moved by dispute`, `Reassigned by
 * admin`); the tooltip says who BuddyX credits, who Bluu holds it on, and that
 * pay follows Bluu.
 *
 * The sync itself credits a BuddyX sale to the agent the shift schedule had on
 * the account (`attributedBy: 'schedule'`), because BuddyX credits a PPV to its
 * sender. Such a row differs from BuddyX with no transfer at all; it gets a
 * quiet *Assigned by shift* note naming who BuddyX credits.
 *
 * Hues borrow `STATUS_COLORS` (DESIGN.md §2): blue is information — the row
 * differs for a recorded reason — and orange is attention: the attribution has
 * since moved a moved sale to someone else (`attributionConflict`). A move the
 * attribution has since agreed with is a quiet greyscale note.
 */
import { ArrowLeftRight, CalendarClock, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { STATUS_COLORS } from '@/lib/campaignTracking';
import { cn } from '@/lib/utils';
import type { SalarySale } from '@/lib/salary/salaryTypes';

const INFO = STATUS_COLORS['In Progress'];
const ATTENTION = STATUS_COLORS['Awaiting Approval'];
const QUIET = 'text-zinc-400 bg-white/[0.06]';

/** A uid as a reader should see it: "you" on their own report, "nobody" for no one. */
export function holderName(uid: string | null, names: Record<string, string>, viewerUid?: string | null): string {
  if (uid === null) return 'nobody';
  if (uid === viewerUid) return 'you';
  return names[uid] || 'another agent';
}

/** Who BuddyX credits a sale to — including a chatter not linked to any Bluu user. */
export function buddyxCreditName(sale: SalarySale, names: Record<string, string>, viewerUid?: string | null): string {
  if (sale.buddyxUserId === null && sale.unmappedChatterId) return `${sale.employeeName || 'a chatter'} (not linked to Bluu)`;
  return holderName(sale.buddyxUserId, names, viewerUid);
}

/** Who the sync credits a sale to, said with why: the agent on shift, or BuddyX's chatter. */
export function sourceCreditName(sale: SalarySale, names: Record<string, string>, viewerUid?: string | null): string {
  if (sale.attributedBy !== 'schedule') return buddyxCreditName(sale, names, viewerUid);
  const who = holderName(sale.sourceUserId, names, viewerUid);
  return who === 'you' ? 'you, as you were on shift' : `${who}, who was on shift`;
}

export function SaleHolderNote({
  sale,
  names,
  viewerUid,
}: {
  sale: SalarySale;
  names: Record<string, string>;
  /** The agent whose report this is — they read "you" instead of their name. */
  viewerUid?: string | null;
}) {
  const buddyx = buddyxCreditName(sale, names, viewerUid);
  const held = holderName(sale.userId, names, viewerUid);

  if (!sale.transfer && sale.matchesSource) {
    if (sale.attributedBy !== 'schedule') return null;
    const why = sale.kind === 'ppv' ? 'BuddyX gives a PPV to whoever sent it' : 'BuddyX’s own shift record differs from the schedule';
    return (
      <Pill tone={QUIET} pill="Assigned by shift" icon={CalendarClock}>
        {held === 'you' ? 'You were' : `${held} was`} on shift on this account, so it’s credited to {held}. BuddyX credits {buddyx} —{' '}
        {why}. Pay follows the shift.
      </Pill>
    );
  }

  const credited = sourceCreditName(sale, names, viewerUid);
  const sourceLabel = sale.attributedBy === 'schedule' ? 'Schedule' : 'BuddyX';
  let label = 'Moved by dispute';
  let because = 'An approved dispute moved it.';
  if (sale.assignment === 'admin') {
    const admin = (sale.transfer && names[sale.transfer.approvedBy]) || 'An admin';
    label = 'Reassigned by admin';
    because = `${admin} reassigned it${sale.transfer?.reason ? `: “${sale.transfer.reason}”` : ''}.`;
  }

  if (sale.attributionConflict) {
    return (
      <Pill tone={ATTENTION} pill={`${label} · ${sourceLabel} changed since`}>
        {because} It has since been credited to {credited}. Bluu Backend still holds it on {held} — pay follows Bluu Backend.
      </Pill>
    );
  }
  if (sale.matchesSource) {
    return (
      <Pill tone={QUIET} pill={`${label} · ${sourceLabel} agrees`}>
        {because} It is now credited to {credited} too.
      </Pill>
    );
  }
  return (
    <Pill tone={INFO} pill={label}>
      {sale.attributedBy === 'schedule'
        ? `Credited to ${credited} (BuddyX credits ${buddyx}).`
        : `Doesn’t match BuddyX, which credits ${buddyx}.`}{' '}
      Bluu Backend holds it on {held}. {because} Pay follows Bluu Backend.
    </Pill>
  );
}

function Pill({
  tone,
  pill,
  icon: Icon = ArrowLeftRight,
  children,
}: {
  tone: string;
  pill: string;
  /** ⇄ for a move; a calendar for a credit the shift schedule made, which moved nothing. */
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={pill}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            tone,
          )}
        >
          <Icon className="size-3" aria-hidden />
          {pill}
        </button>
      </TooltipTrigger>
      {/* Radix links the content to the trigger (aria-describedby), so a
          screen reader hears the pill, then the sentence. */}
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}
