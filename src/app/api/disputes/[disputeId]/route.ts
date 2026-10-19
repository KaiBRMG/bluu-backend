import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { serialiseDisputes } from '@/lib/services/disputeSerialise';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/disputes/[disputeId] — one dispute, serialised (`ca-admin`).
 *
 * CA Admin → Sales' Disputed view carries only each sale's outcome; opening the
 * claim behind a row (the argument, who filed and approved it, what moved) is
 * this read, on demand — one document, never a page of them up front.
 *
 * Uncached (rule 9i): the admin may be about to overturn it.
 */
export const GET = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ disputeId: string }> | { disputeId: string },
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'ca-admin');
    if (denied) return denied;

    const { disputeId } = await Promise.resolve(params);
    const snap = await adminDb.collection('disputes').doc(disputeId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });

    const [dispute] = await serialiseDisputes([{ _id: snap.id, ...snap.data() }]);
    return NextResponse.json({ dispute }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[disputes/[id] GET]', error);
    return NextResponse.json({ error: 'Failed to load the dispute' }, { status: 500 });
  }
});
