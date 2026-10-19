/**
 * Dispute lifecycle — the derived vocabulary the CA portal reads.
 *
 * A dispute carries two raw enums (`CaApproval`, `AdminApproval`) plus an
 * `assignedTo` that may be the sentinel 'No One'. Nobody thinks in those three
 * fields; they think "where is this?". `disputeStage` collapses them into one
 * closed vocabulary, and the hue for each stage is borrowed from the campaign
 * status palette rather than re-typed — DESIGN.md §2, the Semantic-Only Rule.
 */

import { STATUS_COLORS, STATUS_DOT, type CRStatus } from '@/lib/campaignTracking';
import type { DisputeDocument } from '@/types/firestore';
import { NO_ONE, type SaleDisputeOutcome } from '@/lib/disputes/disputeRules';
import { pluralise } from '@/lib/salary/salaryFormat';
import { safeTimezone } from '@/lib/utils/timezone';

/**
 * Query parameter that opens the dashboard's All-disputes dialog on arrival.
 *
 * Named here rather than typed at both ends: the redirect that writes it
 * (`/ca-portal/disputes`) and the panel that reads it are in different trees,
 * and a typo in either is a silent no-op — the dashboard would simply open
 * without the dialog and nobody would know why.
 */
export const DISPUTES_OPEN_ALL_PARAM = 'disputes';

export type DisputeStage =
  | 'awaiting-ca'
  | 'awaiting-admin'
  | 'declined-ca'
  | 'approved'
  | 'overturned'
  | 'rejected';

/** Each stage maps onto an existing semantic hue; never a fresh hex. */
const STAGE_HUE: Record<DisputeStage, CRStatus> = {
  'awaiting-ca': 'Awaiting Approval', // orange — waiting on a person
  'awaiting-admin': 'In Progress',    // blue   — moving, not waiting on the filer
  'declined-ca': 'Rejected',          // red
  approved: 'Completed',              // green
  overturned: 'Rejected',             // red
  rejected: 'Rejected',               // red
};

export const STAGE_LABEL: Record<DisputeStage, string> = {
  'awaiting-ca': 'Awaiting CA review',
  'awaiting-admin': 'Awaiting admin',
  'declined-ca': 'Declined by CA',
  approved: 'Approved',
  overturned: 'Overturned by admin',
  rejected: 'Rejected by admin',
};

/** The one-line "what happens next", used as the pill's accessible title. */
export const STAGE_HINT: Record<DisputeStage, string> = {
  'awaiting-ca': 'The chatter it was assigned to has not reviewed it yet.',
  'awaiting-admin': 'No agent holds this sale, so an admin rules on it.',
  'declined-ca': 'The chatter it was assigned to declined it. Check your notifications for their reason.',
  approved: 'Approved — the sale has moved onto your earnings report.',
  overturned: 'An admin overturned the approval. The sales went back to where they were.',
  rejected: 'An admin rejected it. The sale stays where it was.',
};

export type DisputeStageInput = Pick<DisputeDocument, 'CaApproval' | 'AdminApproval' | 'assignedTo'> &
  Partial<Pick<DisputeDocument, 'overturnedAt'>>;

/**
 * Since 2026-10-19 the holder's approval is final, so `AdminApproval` is the
 * verdict whoever gave it — a CA approval sets both. `awaiting-admin` now means
 * a claim on a sale nobody holds (or one left half-approved by the old flow).
 */
export function disputeStage(d: DisputeStageInput): DisputeStage {
  if (d.AdminApproval === 'Approved') return 'approved';
  if (d.AdminApproval === 'Rejected') return d.overturnedAt ? 'overturned' : 'rejected';
  if (d.CaApproval === 'Rejected') return 'declined-ca';
  // 'No One' has no holder to approve, so it waits on an admin.
  if (d.CaApproval === 'Approved' || d.assignedTo === NO_ONE) return 'awaiting-admin';
  return 'awaiting-ca';
}

export const stagePillClass = (stage: DisputeStage): string => STATUS_COLORS[STAGE_HUE[stage]];
export const stageDotClass = (stage: DisputeStage): string => STATUS_DOT[STAGE_HUE[stage]];

// ─── Per-sale outcome (CA Admin → Sales, Disputed view) ───────────────

/** Same borrowing rule as the stages: orange waits on a person, green moved, red refused. */
const OUTCOME_HUE: Record<SaleDisputeOutcome, CRStatus> = {
  open: 'Awaiting Approval',
  moved: 'Completed',
  skipped: 'Awaiting Approval',
  reverted: 'Archived',
  declined: 'Rejected',
  overturned: 'Rejected',
  rejected: 'Rejected',
};

export const OUTCOME_LABEL: Record<SaleDisputeOutcome, string> = {
  open: 'Open',
  moved: 'Moved',
  skipped: 'Not moved',
  reverted: 'Reverted',
  declined: 'Declined by CA',
  overturned: 'Overturned',
  rejected: 'Rejected by admin',
};

export const outcomePillClass = (outcome: SaleDisputeOutcome): string => STATUS_COLORS[OUTCOME_HUE[outcome]];

// ─── Formatters ───────────────────────────────────────────────────────

export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Sale dates are stored UTC; every surface reads them in the user's own tz. */
export function formatSaleDate(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimezone(timezone),
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * The same instant, short enough for a dashboard column.
 *
 * `formatSaleDate` renders `Sep 12, 2026, 2:32 PM` — correct on a table row and
 * three characters too wide for a 23rem column, where it pushes the filer's
 * name into an ellipsis. The year is what goes: a dispute is filed against a
 * recent sale, and the full stamp is one click away in the detail dialog.
 */
export function formatSaleDateCompact(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimezone(timezone),
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * What a verdict did, in words — the holder's Approve moves money now, so the
 * toast says how much moved rather than just "approved".
 */
export function verdictToast(
  verdict: 'Approved' | 'Rejected',
  transferResult: DisputeDocument['transferResult'],
): string {
  if (verdict === 'Rejected') return 'Dispute rejected';
  if (!transferResult) return 'Dispute approved';
  const { transferred, skipped } = transferResult;
  return (
    `Approved · ${pluralise(transferred.length, 'sale')} moved` +
    (skipped.length ? ` · ${skipped.length} not moved — ${skipReasons(skipped)}` : '')
  );
}

/** "month finalised, held by another dispute" — each distinct reason once. */
export function skipReasons(skipped: Array<{ reason: string }>): string {
  return [...new Set(skipped.map(s => s.reason))].join(', ');
}
