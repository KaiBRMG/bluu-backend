import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { checkProxy } from '@/lib/gologin/proxyCheck';
import { requireGoLoginAccessAnd } from '@/lib/services/gologinService';
import { isGoLoginId } from '@/lib/gologin';
import {
  manageErrorResponse,
  parseProxyInput,
  withResolvedPassword,
} from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/manage/proxy-check — "Ping proxy".
 *
 * Body: `{ proxy: {...}, profileId? }`. When the proxy omits `password` and a
 * `profileId` is given, the password stored on that profile is used — the Edit
 * panel's "keep the current password" case, where the manager never saw it.
 * The stored secret is read and used here and never returned.
 *
 * Costs **no** GoLogin request unless that stored password is needed (then
 * one). The check itself goes to `geo.myip.link` through the proxy — see
 * `proxyCheck.ts` for the SSRF fence around an outbound connection to an
 * address a user typed.
 *
 * Gated on **Create, Edit & Delete Profiles**: it is part of creating and
 * editing, and an ungated "connect anywhere" endpoint is not something to leave
 * lying around. Throttled per user so a held-down button cannot turn it into a
 * port scanner. Not cacheable: the answer is the proxy's state right now.
 */
export const maxDuration = 30;

/** One check per user at a time, and not more often than this. */
const MIN_INTERVAL_MS = 1500;
const lastCheckAt = new Map<string, number>();

export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;

  const now = Date.now();
  if (now - (lastCheckAt.get(token.uid) ?? 0) < MIN_INTERVAL_MS) {
    return NextResponse.json({ error: 'One moment — the last check is still settling.' }, { status: 429 });
  }
  lastCheckAt.set(token.uid, now);
  // Bounded: an unbounded module-scope map is a leak by construction.
  if (lastCheckAt.size > 500) lastCheckAt.clear();

  const parsed = await readJsonBody(req, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  try {
    const proxy = await withResolvedPassword(
      parseProxyInput(body.proxy),
      isGoLoginId(body.profileId) ? body.profileId : null,
    );
    const result = await checkProxy(proxy);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return manageErrorResponse(err, 'check that proxy');
  }
});
