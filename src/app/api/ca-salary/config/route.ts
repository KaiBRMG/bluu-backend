/**
 * GET /api/ca-salary/config — the rate tables
 * PUT /api/ca-salary/config — replace them (admin claim)
 *
 * The config is read over HTTP by every surface that shows a figure, never
 * compiled in (rule 9c): an Electron renderer can be weeks old, and a rate the
 * app displays must not disagree with the rate the server pays.
 *
 * GET is open to any authenticated user because an agent's own dashboard renders
 * the tier ladder from it — the rates are a term of their employment, not a
 * secret. PUT is the **admin claim**: a tier change silently restates every
 * agent's month.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { getSalaryConfig, setSalaryConfig } from '@/lib/services/caSalaryService';
import { getUserById } from '@/lib/services/userService';
import type { SalaryConfig, WageRateBasis } from '@/lib/salary/salaryTypes';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async () => {
  try {
    return NextResponse.json({ config: await getSalaryConfig() });
  } catch (err) {
    return handleApiError(err, 'ca-salary/config GET');
  }
});

/**
 * Validate a submitted rate table.
 *
 * Every rule here exists because the alternative is a silently wrong payout: an
 * empty tier list would pay no commission at all, an unsorted one would read the
 * wrong band, a deduction over 1 would invert the net, and a duplicate threshold
 * makes which tier applies depend on map ordering.
 */
function validate(body: unknown): { config: Omit<SalaryConfig, 'updatedBy' | 'updatedAt'> } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Body must be an object' };
  const b = body as Record<string, unknown>;

  const deductionRate = Number(b.deductionRate);
  if (!Number.isFinite(deductionRate) || deductionRate < 0 || deductionRate >= 1) {
    return { error: 'Deduction must be between 0% and 100%.' };
  }

  const graceMinutes = Number(b.graceMinutes);
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    return { error: 'Grace period must be between 0 and 120 minutes.' };
  }

  const defaultShiftHours = Number(b.defaultShiftHours);
  if (!Number.isFinite(defaultShiftHours) || defaultShiftHours <= 0 || defaultShiftHours > 24) {
    return { error: 'A shift must be between 0 and 24 hours.' };
  }

  const wageRateBasis = b.wageRateBasis as WageRateBasis;
  if (wageRateBasis !== 'per-shift' && wageRateBasis !== 'per-day') {
    return { error: "Wage rate basis must be 'per-shift' or 'per-day'." };
  }

  if (!Array.isArray(b.commissionTiers) || b.commissionTiers.length === 0) {
    return { error: 'At least one commission tier is required.' };
  }

  const commissionTiers: Array<{ minGross: number; percent: number }> = [];
  for (const raw of b.commissionTiers) {
    const minGross = Number((raw as Record<string, unknown>)?.minGross);
    const percent = Number((raw as Record<string, unknown>)?.percent);
    if (!Number.isFinite(minGross) || minGross < 0) return { error: 'Every tier needs a threshold of 0 or more.' };
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { error: 'Every tier needs a percentage between 0 and 100.' };
    }
    commissionTiers.push({ minGross, percent });
  }

  commissionTiers.sort((a, b2) => a.minGross - b2.minGross);
  if (commissionTiers[0].minGross !== 0) {
    return { error: 'The lowest tier must start at 0 — otherwise early sales earn no commission at all.' };
  }
  for (let i = 1; i < commissionTiers.length; i++) {
    if (commissionTiers[i].minGross === commissionTiers[i - 1].minGross) {
      return { error: `Two tiers both start at $${commissionTiers[i].minGross}. Thresholds must be distinct.` };
    }
  }

  const wageTiersRaw = b.wageTiers;
  if (typeof wageTiersRaw !== 'object' || wageTiersRaw === null) {
    return { error: 'Wage tiers are required.' };
  }

  const wageTiers: Record<number, number> = {};
  for (const [key, value] of Object.entries(wageTiersRaw as Record<string, unknown>)) {
    const count = Number(key);
    const rate = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return { error: 'Wage tiers must be keyed by an account count between 1 and 20.' };
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
      return { error: 'Each hourly rate must be between $0 and $1000.' };
    }
    wageTiers[count] = rate;
  }
  if (Object.keys(wageTiers).length === 0) return { error: 'At least one wage tier is required.' };

  return {
    config: { deductionRate, commissionTiers, wageTiers, graceMinutes, defaultShiftHours, wageRateBasis },
  };
}

export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const result = validate(await request.json());
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const actor = await getUserById(token.uid);
    await setSalaryConfig(result.config, token.uid, actor?.displayName ?? token.email ?? token.uid);

    return NextResponse.json({ config: await getSalaryConfig() });
  } catch (err) {
    return handleApiError(err, 'ca-salary/config PUT');
  }
});
