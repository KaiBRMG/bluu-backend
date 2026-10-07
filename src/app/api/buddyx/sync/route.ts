import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { isBuddyxScope, SCOPE_PAGE } from '@/lib/buddyx/constants';
import { isBuddyxConfigured } from '@/lib/buddyx/client';
import { refreshCooldown, runBuddyxSync } from '@/lib/services/buddyxSyncService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/buddyx/sync  `{ scope, preview? }` — the refresh button.
 *
 * Who may press it depends on the scope, and is the page the button lives on:
 * `sales` → `ca-dashboard` or `ca-admin`; `chatters` → `ca-chatter-analytics`;
 * `fans` → `ca-fan-analytics`; `creators` → `creators-of-analytics`;
 * `directory` → the admin claim (it re-resolves who gets paid for what).
 *
 * `preview: true` (sales only, admin claim) runs the sales pass as a dry run
 * and returns the per-agent, per-day totals — the check an admin makes against
 * the BuddyX dashboard before switching the sales sync on.
 *
 * Three answers besides a completed run:
 * - **202 `{ fresh: true }`** — the scope synced (or tried) within the last two
 *   minutes. No API call is made, so a mashed button costs nothing.
 * - **409 `{ running }`** — another sync holds the lease; the client polls
 *   `/api/buddyx/status` until it clears.
 * - **503** — `BUDDYX_API_KEY` is not set on this deployment.
 */
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const parsed = await readJsonBody(request, 1024);
    if (!parsed.ok) return parsed.response;
    const { scope, preview } = parsed.body as { scope?: unknown; preview?: unknown };

    if (!isBuddyxScope(scope)) {
      return NextResponse.json({ error: 'Unknown scope' }, { status: 400 });
    }

    const pages = SCOPE_PAGE[scope];
    const isPreview = preview === true;
    if (pages === null || isPreview) {
      const denied = requireAdminClaim(token);
      if (denied) return denied;
    } else if (token.admin !== true) {
      const denied = await checkPageAccess(token.uid, pages);
      if (denied) return denied;
    }
    if (isPreview && scope !== 'sales') {
      return NextResponse.json({ error: 'Only the sales scope has a preview' }, { status: 400 });
    }

    if (!isBuddyxConfigured()) {
      return NextResponse.json({ error: 'BuddyX is not configured on this deployment.' }, { status: 503 });
    }

    if (!isPreview) {
      const cooldown = await refreshCooldown(scope);
      if (cooldown.cooling) {
        return NextResponse.json({ fresh: true, syncedAt: cooldown.syncedAt }, { status: 202 });
      }
    }

    const outcome = await runBuddyxSync({ scopes: [scope], trigger: token.uid, salesPreview: isPreview });
    if (!outcome.ok) {
      return NextResponse.json({ running: outcome.running }, { status: 409 });
    }

    const { result } = outcome;
    const failed = result.failed.includes(scope);
    return NextResponse.json(
      {
        ok: !failed,
        error: failed ? result.errors.find(e => e.startsWith(`${scope}:`)) ?? 'Sync failed' : null,
        partial: result.partial,
        counts: result.counts,
        // Only the preview returns sales detail; a normal refresh is read back
        // through the page's own route.
        preview: isPreview ? result.sales : undefined,
      },
      { status: failed ? 502 : 200 },
    );
  } catch (error) {
    return handleApiError(error, 'POST /api/buddyx/sync');
  }
});
