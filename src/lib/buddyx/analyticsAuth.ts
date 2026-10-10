/**
 * Who may see what on the three BuddyX analytics pages.
 *
 * Each page has its own permission (tier 2, `checkPageAccess`). Holding
 * `ca-admin` as well — or the admin claim — is what turns an agent's own view
 * into the named, all-creator one. Both checks read the cached user doc
 * (`getUserById`, 60s), so this costs no extra Firestore read.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { checkPageAccess } from '../middleware/apiHelpers';
import { CA_ADMIN_PAGE_ID } from '../salary/salaryAuth';
import { isDayKey } from '../salary/salaryDate';
import { CHATTER_PERIODS, MAX_CUSTOM_DAYS, type ChatterPeriod } from './analyticsTypes';

export async function analyticsAccess(
  token: DecodedIdToken,
  pageId: string,
): Promise<{ isAdmin: boolean } | NextResponse> {
  if (token.admin === true) return { isAdmin: true };
  const denied = await checkPageAccess(token.uid, pageId);
  if (denied) return denied;
  return { isAdmin: (await checkPageAccess(token.uid, CA_ADMIN_PAGE_ID)) === null };
}

/**
 * `?period=…[&from&to]` for the Chatter Analytics routes — a validated period,
 * or the 400 to return. Absent `period` → `fallback`.
 */
export function parseChatterPeriod(
  searchParams: URLSearchParams,
  fallback: ChatterPeriod,
): { period: ChatterPeriod; from: string | null; to: string | null } | NextResponse {
  const period = (searchParams.get('period') ?? fallback) as ChatterPeriod;
  if (!CHATTER_PERIODS.includes(period)) return NextResponse.json({ error: 'Unknown period' }, { status: 400 });
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (period === 'custom') {
    if (!isDayKey(from) || !isDayKey(to) || from > to) {
      return NextResponse.json({ error: 'A custom range needs from ≤ to (YYYY-MM-DD).' }, { status: 400 });
    }
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_CUSTOM_DAYS) {
      return NextResponse.json({ error: `A custom range can span at most ${MAX_CUSTOM_DAYS} days.` }, { status: 400 });
    }
  }
  return { period, from, to };
}

/** Per-viewer response: the browser may reuse it for a minute, never another user. */
export const ANALYTICS_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' };
