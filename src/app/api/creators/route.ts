import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getAssignableAccounts } from '@/lib/services/creatorAccountService';

/**
 * GET /api/creators
 *
 * Every **assignable creator account** — creators and their sub-accounts — as
 * one flat, grouped list. Used across the employee-facing app wherever creator
 * names and avatars are shown.
 *
 * ## Why sub-accounts are in the same response
 *
 * A sub-account ("Cole (Fansly)") is a peer of its parent for shift assignment
 * and pay. Serving them from a second endpoint would mean a second fetch, a
 * second cache and a second store for data that is rendered by the same chips —
 * exactly the duplication `useCreators`' shared store exists to avoid.
 *
 * Callers that want creators only — Custom Requests, Campaigns, Content
 * Planning, where the subject is the creator as a brand rather than an account
 * to staff — filter on `isSubAccount` via the `useCreators()` view. The shift
 * assignment picker uses `useAssignableAccounts()` and gets the lot.
 *
 * Visibility is governed by `isArchived` only. `isActive` solely controls
 * whether the creator can log into their own portal, so a merely-deactivated
 * creator's data must still appear here.
 *
 * `photoThumb` is a 64px WebP `data:` URI (a couple of KB each) and is why this
 * response is deliberately chunkier than it looks: inlining the avatars here is
 * what lets a thirty-avatar shift calendar render without issuing thirty image
 * requests to Firebase Storage. The roster is fetched once per app session and
 * cached in `sessionStorage` by `useCreators`, so it is paid for once and the
 * avatars arrive free with it. A sub-account with no photo of its own inherits
 * the parent's, resolved server-side.
 */
export const GET = withAuth(async () => {
  try {
    const accounts = await getAssignableAccounts();

    const creators = accounts.map(a => ({
      creatorID: a.creatorID,
      stageName: a.stageName,
      defaultTimezone: a.defaultTimezone,
      isArchived: a.isArchived,
      photoURL: a.photoURL,
      photoThumb: a.photoThumb,
      isSubAccount: a.isSubAccount,
      parentCreatorId: a.parentCreatorId,
      parentStageName: a.parentStageName,
    }));

    return NextResponse.json({ creators });
  } catch (error) {
    return handleApiError(error, 'creators GET');
  }
});
