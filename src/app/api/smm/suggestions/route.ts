import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SMM_SUGGESTIONS,
  checkSmmAccess,
  resolveUserInfo,
  serializeSuggestion,
} from '@/lib/services/smmService';
import { extractAccountHandle } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/suggestions — pending viral-page suggestions (admin page only),
 * shown in Bonus Management. Approved/denied entries are filtered in the query
 * so the list stays small as history accumulates (equality-only conjunction —
 * served by single-field indexes, no composite needed).
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const snap = await adminDb
      .collection(SMM_SUGGESTIONS)
      .where('isApproved', '==', false)
      .where('isRejected', '==', false)
      .get();

    const suggestions = snap.docs.map(serializeSuggestion)
      .sort((a, b) => (b.submissionDate ?? '').localeCompare(a.submissionDate ?? ''));
    const names = await resolveUserInfo(suggestions.map((s) => s.submittedBy));
    for (const s of suggestions) {
      s.submittedByName = names.get(s.submittedBy)?.displayName ?? '';
      s.submittedByPhotoURL = names.get(s.submittedBy)?.photoURL ?? null;
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[GET /api/smm/suggestions]', error);
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 });
  }
});

/**
 * POST /api/smm/suggestions — an SMM nominates an account to copy viral posts
 * from. The submitter and timestamp are taken from the session, never the body,
 * and accountName is derived from the link server-side.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'viral');
    if (denied) return denied;

    const body = await request.json() as { accountLink?: string };
    const accountLink = body.accountLink?.trim() ?? '';
    const accountName = extractAccountHandle(accountLink);
    if (!accountName) {
      return NextResponse.json(
        { error: 'Enter a valid X/Twitter account link (e.g. https://x.com/example)' },
        { status: 400 },
      );
    }

    const ref = adminDb.collection(SMM_SUGGESTIONS).doc();
    await ref.set({
      accountName,
      accountLink,
      submittedBy: token.uid,
      submissionDate: FieldValue.serverTimestamp(),
      isApproved: false,
      isRejected: false,
    });

    return NextResponse.json({ success: true, id: ref.id, accountName });
  } catch (error) {
    console.error('[POST /api/smm/suggestions]', error);
    return NextResponse.json({ error: 'Failed to submit suggestion' }, { status: 500 });
  }
});
