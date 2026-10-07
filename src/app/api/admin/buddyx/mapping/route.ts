import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim, requireCaAdmin } from '@/lib/salary/salaryAuth';
import { adminDb } from '@/lib/firebase-admin';
import {
  CHATTERS,
  MODELS,
  setManualChatterLink,
  setManualModelLink,
} from '@/lib/services/buddyxMappingService';
import { displayNamesFor } from '@/lib/services/userService';
import type { BuddyxChatterDocument, BuddyxModelDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET   /api/admin/buddyx/mapping — every BuddyX chatter and creator, and the
 *       Bluu identity each resolves to (`ca-admin`).
 * PATCH /api/admin/buddyx/mapping `{ kind: 'chatter' | 'model', id, target }`
 *       — link manually, or `target: null` to clear (admin claim).
 *
 * Linking is the admin claim, not the page permission (rule 3): it decides whose
 * pay a BuddyX chatter's sales land in. The change re-stamps open-month rows on
 * the next `sales` run, not here — the sync is the only writer of BuddyX rows.
 *
 * Uncached: the screen it serves edits it.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const [chatterSnap, modelSnap] = await Promise.all([
      adminDb.collection(CHATTERS).get(),
      adminDb.collection(MODELS).get(),
    ]);
    const chatters = chatterSnap.docs.map(d => d.data() as BuddyxChatterDocument);
    const models = modelSnap.docs.map(d => d.data() as BuddyxModelDocument);
    const names = await displayNamesFor(chatters.map(c => c.uid));

    return NextResponse.json(
      {
        chatters: chatters
          .map(c => ({
            chatterId: c.chatterId,
            name: c.name,
            email: c.email,
            status: c.status,
            uid: c.uid,
            displayName: c.uid ? names.get(c.uid) ?? null : null,
            match: c.match,
          }))
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        models: models
          .map(m => ({
            modelId: m.modelId,
            handle: m.handle,
            customName: m.customName,
            creatorId: m.creatorId,
            creatorName: m.creatorName,
            match: m.match,
          }))
          .sort((a, b) => (a.handle ?? '').localeCompare(b.handle ?? '')),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/buddyx/mapping');
  }
});

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const parsed = await readJsonBody(request, 1024);
    if (!parsed.ok) return parsed.response;
    const { kind, id, target } = parsed.body as { kind?: unknown; id?: unknown; target?: unknown };

    if ((kind !== 'chatter' && kind !== 'model') || typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }
    if (target !== null && (typeof target !== 'string' || !target)) {
      return NextResponse.json({ error: 'target must be an id or null' }, { status: 400 });
    }

    try {
      if (kind === 'chatter') await setManualChatterLink(id, target, token.uid);
      else await setManualModelLink(id, target, token.uid);
    } catch (err) {
      return handleApiError(err, 'PATCH /api/admin/buddyx/mapping', 400);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/buddyx/mapping');
  }
});
