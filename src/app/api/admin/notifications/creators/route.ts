import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface CreatorRecipient {
  uid: string;
  stageName: string;
}

const CACHE_TTL_MS = 30_000;
let cache: { data: CreatorRecipient[]; expiresAt: number } | null = null;

export function invalidateCreatorRecipientsCache(): void {
  cache = null;
}

/**
 * GET /api/admin/notifications/creators
 *
 * A deliberately narrow projection for the Create Notification recipient
 * picker — just enough to list and label a creator, nothing `/api/admin/creators`
 * exposes beyond that. Gated on `admin-notifications` rather than
 * `admin-creator-management`: sending a notification to a creator should not
 * require the separate permission to manage creator accounts.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-notifications');
    if (denied) return denied;

    if (cache && Date.now() < cache.expiresAt) {
      return NextResponse.json({ creators: cache.data });
    }

    // Archived creators are filtered out — same rule as every other recipient
    // picker in the app (cross-cutting rule 6). Filtered in-process rather than
    // with a `where`, matching `/api/admin/creators`: `isArchived` is not
    // otherwise queried, so it stays exempt from indexing (rule 9).
    const snap = await adminDb.collection('creators').get();
    const creators: CreatorRecipient[] = snap.docs
      .filter(doc => doc.data().isArchived !== true)
      .map(doc => ({
        uid: doc.id,
        stageName: (doc.data().stageName as string | undefined) ?? doc.id,
      }))
      .sort((a, b) => a.stageName.localeCompare(b.stageName));

    cache = { data: creators, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json({ creators });
  } catch (error: unknown) {
    console.error('[admin/notifications/creators GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});
