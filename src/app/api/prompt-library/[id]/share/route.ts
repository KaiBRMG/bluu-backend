import { NextResponse } from 'next/server';
import { ensurePromptShare, revokePromptShare } from '@/lib/services/promptLibraryService';
import { promptShareUrl } from '@/lib/promptShareUrl';
import { withPromptAuth } from '../../_guard';

/**
 * POST /api/prompt-library/[id]/share
 *
 * Mints (or returns) the prompt's public share token and the URL built from it.
 * Idempotent — turning it on twice gives the same link, so a link already sent
 * to someone keeps resolving.
 *
 * Tier 2, the `apps-prompt-library` page permission, PLUS edit access to this
 * prompt (editors and admins): sharing is an ordinary act in the same class as
 * archiving, not an authorisation-graph change, so it needs no admin claim —
 * but it IS the act that puts prompt text on the open internet, which is why it
 * is explicit and revocable rather than automatic.
 */
export const POST = withPromptAuth('prompt-library share POST', 'edit', async (_req, { token, id }) => {
  const shareId = await ensurePromptShare(id, token.uid);
  if (!shareId) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });

  return NextResponse.json({ shareId, url: promptShareUrl(shareId) });
});

/**
 * DELETE /api/prompt-library/[id]/share
 *
 * Withdraws the public link. The token is destroyed, not parked — re-sharing
 * later mints a new one, so a link that has been revoked is dead for good.
 */
export const DELETE = withPromptAuth('prompt-library share DELETE', 'edit', async (_req, { id }) => {
  const ok = await revokePromptShare(id);
  if (!ok) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });

  return NextResponse.json({ success: true });
});
