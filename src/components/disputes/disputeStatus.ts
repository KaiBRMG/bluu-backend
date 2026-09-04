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

export type DisputeStage =
  | 'awaiting-ca'
  | 'awaiting-admin'
  | 'declined-ca'
  | 'approved'
  | 'rejected';

/** Each stage maps onto an existing semantic hue; never a fresh hex. */
const STAGE_HUE: Record<DisputeStage, CRStatus> = {
  'awaiting-ca': 'Awaiting Approval', // orange — waiting on a person
  'awaiting-admin': 'In Progress',    // blue   — moving, not waiting on the filer
  'declined-ca': 'Rejected',          // red
  approved: 'Completed',              // green
  rejected: 'Rejected',               // red
};

export const STAGE_LABEL: Record<DisputeStage, string> = {
  'awaiting-ca': 'Awaiting CA review',
  'awaiting-admin': 'Awaiting admin',
  'declined-ca': 'Declined by CA',
  approved: 'Approved',
  rejected: 'Rejected by admin',
};

/** The one-line "what happens next", used as the pill's accessible title. */
export const STAGE_HINT: Record<DisputeStage, string> = {
  'awaiting-ca': 'The chatter it was assigned to has not reviewed it yet.',
  'awaiting-admin': 'Cleared review — an admin has the final call.',
  'declined-ca': 'The chatter it was assigned to declined it. Check your notifications for their reason.',
  approved: 'Approved — the sale has moved onto your earnings report.',
  rejected: 'An admin rejected it. The sale stays where it was.',
};

export type DisputeStageInput = Pick<
  DisputeDocument,
  'CaApproval' | 'AdminApproval' | 'assignedTo'
>;

export function disputeStage(d: DisputeStageInput): DisputeStage {
  if (d.AdminApproval === 'Approved') return 'approved';
  if (d.AdminApproval === 'Rejected') return 'rejected';
  if (d.CaApproval === 'Rejected') return 'declined-ca';
  // 'No One' skips CA review entirely and lands straight on the admin desk.
  if (d.CaApproval === 'Approved' || d.assignedTo === 'No One') return 'awaiting-admin';
  return 'awaiting-ca';
}

export const stagePillClass = (stage: DisputeStage): string => STATUS_COLORS[STAGE_HUE[stage]];
export const stageDotClass = (stage: DisputeStage): string => STATUS_DOT[STAGE_HUE[stage]];

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
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
