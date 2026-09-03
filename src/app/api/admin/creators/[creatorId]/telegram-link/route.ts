/**
 * Creator Telegram invites, for the admin on Creator Management.
 *
 * POST mints a fresh one-time link (voiding any outstanding one) and returns the
 * `t.me` URL for the admin to copy and send. DELETE disconnects a creator's
 * Telegram account — which, since Telegram is now the *only* way into the
 * creator portal, also locks them out until a new link is used. That is the
 * intended shape: it is the "they lost the account" repair.
 *
 * Gated on the `admin-creator-management` page permission, matching the sibling
 * creator routes. Not the admin claim: this manages an external account, not the
 * internal authorization graph (auth.md, tier 2 vs tier 3).
 *
 * **The token is returned exactly once and never stored in plaintext.** If the
 * admin loses it before sending, mint another — there is no "show it again".
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { invalidateAdminCreatorsCache } from '@/app/api/admin/creators/route';
import {
  mintTelegramLinkToken,
  unlinkTelegramAccount,
} from '@/lib/services/telegramLinkService';
import type { DecodedIdToken } from 'firebase-admin/auth';

async function checkPermission(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('admin-creator-management');
}

export const POST = withAuth(
  async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
    try {
      if (!(await checkPermission(token.uid))) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const { creatorId } = await params;
      const { url, expiresAt } = await mintTelegramLinkToken({
        subjectKind: 'creator',
        subjectUid: creatorId,
        createdBy: token.uid,
      });

      // The creators list is cached for 30s; a fresh invite changes the status
      // the table renders, so drop it rather than showing a stale "no link yet".
      invalidateAdminCreatorsCache();

      return NextResponse.json({ url, expiresAt: expiresAt.toISOString() });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'SUBJECT_NOT_FOUND') {
        return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
      }
      console.error('[POST /api/admin/creators/[creatorId]/telegram-link]', error);
      return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
    }
  },
);

export const DELETE = withAuth(
  async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
    try {
      if (!(await checkPermission(token.uid))) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const { creatorId } = await params;
      const { unlinked } = await unlinkTelegramAccount('creator', creatorId);
      invalidateAdminCreatorsCache();

      return NextResponse.json({ success: true, unlinked });
    } catch (error: unknown) {
      console.error('[DELETE /api/admin/creators/[creatorId]/telegram-link]', error);
      return NextResponse.json({ error: 'Failed to disconnect Telegram' }, { status: 500 });
    }
  },
);
