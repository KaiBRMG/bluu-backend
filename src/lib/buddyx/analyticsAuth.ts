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

export async function analyticsAccess(
  token: DecodedIdToken,
  pageId: string,
): Promise<{ isAdmin: boolean } | NextResponse> {
  if (token.admin === true) return { isAdmin: true };
  const denied = await checkPageAccess(token.uid, pageId);
  if (denied) return denied;
  return { isAdmin: (await checkPageAccess(token.uid, CA_ADMIN_PAGE_ID)) === null };
}

/** Per-viewer response: the browser may reuse it for a minute, never another user. */
export const ANALYTICS_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' };
