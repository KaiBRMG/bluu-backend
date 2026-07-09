import { SMM_STATUS_LATE, SMM_STATUS_QUALIFIED } from '@/types/firestore';
import type { SmmNetwork, SmmSubmissionStatus, SmmTier } from '@/types/firestore';

/**
 * Pure bonus calculation engine for SMM Twitter/X submissions.
 * Runs server-side only (the client never computes payouts), but kept free of
 * Firebase imports so it can be exercised directly in tests.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface TierRule {
  minLikes: number;
  maxAgeMs: number; // max (submissionDate - postDate) for the rule to apply
  amount: number;   // dollars
}

/**
 * Target-bonus rules per tier, evaluated top-down — highest bonus first, so a
 * post that clears a higher threshold within its window earns the larger
 * amount (confirmed with the user; SMM.md lists the same rules ascending).
 */
export const TIER_RULES: Record<SmmTier, TierRule[]> = {
  1: [
    { minLikes: 35000, maxAgeMs: 7 * DAY_MS + 12 * HOUR_MS, amount: 25 },
    { minLikes: 20000, maxAgeMs: 5 * DAY_MS + 12 * HOUR_MS, amount: 10 },
    { minLikes: 10000, maxAgeMs: 3 * DAY_MS + 12 * HOUR_MS, amount: 5 },
  ],
  2: [
    { minLikes: 35000, maxAgeMs: 7 * DAY_MS + 12 * HOUR_MS, amount: 15 },
    { minLikes: 20000, maxAgeMs: 5 * DAY_MS + 12 * HOUR_MS, amount: 7 },
    { minLikes: 10000, maxAgeMs: 3 * DAY_MS + 12 * HOUR_MS, amount: 3 },
  ],
};

export interface BonusInput {
  tier: SmmTier;
  network: SmmNetwork;
  numLikes: number;
  postDateMs: number;
  submissionDateMs: number;
  hasOriginalLink: boolean; // true when the post copies another viral post
}

export interface BonusResult {
  bonusAmount: number;
  status: SmmSubmissionStatus;
  sysComments: string;
  /**
   * Amount owed to the original account's owner when a viral post was copied
   * — the halved target bonus, frozen BEFORE the network step (per SMM.md the
   * residual submission is created between the halving and network steps).
   * null when there is no viral copy or the submission did not qualify.
   */
  residualBonusAmount: number | null;
}

export function calculateBonus(input: BonusInput): BonusResult {
  const ageMs = input.submissionDateMs - input.postDateMs;
  const rule = TIER_RULES[input.tier]?.find(
    (r) => input.numLikes >= r.minLikes && ageMs <= r.maxAgeMs,
  );

  if (!rule) {
    // Not qualified: $0 total, no viral or network adjustments (user decision).
    return { bonusAmount: 0, status: SMM_STATUS_LATE, sysComments: '', residualBonusAmount: null };
  }

  let bonusAmount = rule.amount;
  const comments = [`1️⃣ Target Bonus: $${rule.amount}`];
  let residualBonusAmount: number | null = null;

  if (input.hasOriginalLink) {
    bonusAmount /= 2;
    comments.push('6️⃣ Viral Post copied, bonus halved');
    residualBonusAmount = bonusAmount;
  }

  if (input.network === 'Inhouse') {
    bonusAmount += 3;
    comments.push('2️⃣ Network Bonus: $3');
  } else if (input.network === 'X Managed') {
    bonusAmount += 1;
    comments.push('2️⃣ Network Bonus: $1');
  } else if (input.network === 'Twink' && !input.hasOriginalLink) {
    bonusAmount /= 2;
    comments.push('2️⃣ Network Bonus: half 1️⃣ Target Bonus');
  }

  return { bonusAmount, status: SMM_STATUS_QUALIFIED, sysComments: comments.join('\n'), residualBonusAmount };
}
