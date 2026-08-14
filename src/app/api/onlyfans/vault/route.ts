import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { listVaultMediaCached, requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import { OnlyFansApiError, resolveAccountId, type VaultQuery } from '@/lib/onlyfans';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** Provider vault list ids are numeric. Anything else is not a category. */
const LIST_ID = /^[0-9]{1,32}$/;
const TYPES = new Set(['photo', 'video', 'gif', 'audio']);
/** One dialog screen's worth. Every page is a billed call, so this is the cost knob. */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

/**
 * GET /api/onlyfans/vault — a page of the creator's vault media.
 *
 * Backs the composer's "Add from Vault" dialog. Every call is billed, so the
 * page is memoised server-side for a minute and cached again in the client's
 * `sessionStorage`; paging is by offset, and the dialog stops asking when the
 * provider says there is no more.
 *
 * The media comes back as ordinary `OFAttachment`s — a vault entry and a message
 * attachment are the same object — which means the same expiring CDN links, and
 * the same rule: resolve them through `/api/onlyfans/media/resolve`, never
 * persist them.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const search = request.nextUrl.searchParams;

  const listId = search.get('list') ?? undefined;
  if (listId !== undefined && !LIST_ID.test(listId)) {
    return NextResponse.json({ error: 'Invalid vault list' }, { status: 400 });
  }

  const type = search.get('type') ?? undefined;
  if (type !== undefined && !TYPES.has(type)) {
    return NextResponse.json({ error: 'Invalid media type' }, { status: 400 });
  }

  const offset = Number(search.get('offset') ?? 0);
  const limit = Number(search.get('limit') ?? DEFAULT_LIMIT);

  const query: VaultQuery = {
    listId,
    type: type as VaultQuery['type'],
    // Trimmed and capped: it is forwarded to the provider as a search term.
    query: (search.get('q') ?? '').trim().slice(0, 100) || undefined,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_LIMIT) : DEFAULT_LIMIT,
  };

  try {
    const accountId = await resolveAccountId();
    return NextResponse.json(await listVaultMediaCached(accountId, query));
  } catch (error) {
    if (error instanceof OnlyFansApiError) {
      return handleApiError(
        error,
        'GET /api/onlyfans/vault',
        error.status >= 500 ? 502 : error.status,
      );
    }
    return handleApiError(error, 'GET /api/onlyfans/vault');
  }
});
