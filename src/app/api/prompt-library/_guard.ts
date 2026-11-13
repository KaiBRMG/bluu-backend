import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { getPromptRole, getPromptViewer } from '@/lib/services/promptLibraryService';
import type { PromptViewer } from '@/lib/promptAccess';
import type { PromptRole } from '@/types/promptLibrary';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PAGE_ID } from './route';

/**
 * Per-prompt authorisation, layered UNDER the page permission.
 *
 * A prompt the caller cannot see answers 404 — never 403 — so a stranger cannot
 * tell which ids exist. `need: 'view'` admits every grant; `'edit'` admits
 * editors and admins. The role is read fresh, not from the 60s snapshot.
 */
async function guardPrompt(
  token: DecodedIdToken,
  id: string,
  need: PromptRole
): Promise<{ denied: NextResponse } | { viewer: PromptViewer }> {
  const viewer = await getPromptViewer(token.uid, token.admin === true);
  const role = await getPromptRole(id, viewer);
  if (role === 'missing') {
    return { denied: NextResponse.json({ error: 'Prompt not found' }, { status: 404 }) };
  }
  if (need === 'edit' && role !== 'edit') {
    // The caller can see it (they hold a view grant), so a 403 reveals nothing.
    return {
      denied: NextResponse.json({ error: 'You have view-only access to this prompt' }, { status: 403 }),
    };
  }
  return { viewer };
}

export interface PromptRouteContext {
  token: DecodedIdToken;
  id: string;
  viewer: PromptViewer;
}

/**
 * The ONLY way a `/api/prompt-library/[id]/*` route is built: sign-in, the page
 * permission, then the per-prompt role, in that order, with errors handled. A
 * route that skips the check is a route that does not use this wrapper, which a
 * reviewer can see — rather than a missing line that nothing flags.
 *
 * (Hard delete is the one exception: it needs the admin CLAIM, tier 3.)
 */
export function withPromptAuth(
  label: string,
  need: PromptRole,
  handler: (req: NextRequest, ctx: PromptRouteContext) => Promise<NextResponse>
) {
  return withAuth(async (req: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
    try {
      const denied = await checkPageAccess(token.uid, PAGE_ID);
      if (denied) return denied;

      const { id } = await params;
      const guard = await guardPrompt(token, id, need);
      if ('denied' in guard) return guard.denied;

      return await handler(req, { token, id, viewer: guard.viewer });
    } catch (err) {
      return handleApiError(err, label);
    }
  });
}
