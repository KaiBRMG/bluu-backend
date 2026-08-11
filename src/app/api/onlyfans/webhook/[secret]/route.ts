import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { recordLiveMessage } from '@/lib/services/onlyfansService';
import { getOnlyFansClient } from '@/lib/onlyfans';

/**
 * POST /api/onlyfans/webhook/[secret] — provider push endpoint.
 *
 * **Unauthenticated by construction** (the provider has no Bluu session), so
 * the secret in the path is the credential: registered once with the provider,
 * held in `ONLYFANSAPI_WEBHOOK_SECRET`, compared in constant time. Signature
 * verification and payload parsing are provider-specific and therefore live
 * behind `IOnlyFansClient`, not here.
 *
 * Why a webhook at all: it is what keeps the chat list live without polling the
 * provider (every poll is billed). It writes straight into the Firestore mirror
 * that the OF Manager window is already listening to.
 *
 * **Best-effort, never load-bearing.** A payload we cannot parse is logged and
 * acked — the next chat sync corrects any delivery we drop, and retrying an
 * unparsable body would only loop. A failed *write* is the one thing worth a
 * 5xx, because a retry can actually fix it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ secret: string }> },
) {
  const configured = process.env.ONLYFANSAPI_WEBHOOK_SECRET;
  if (!configured) {
    console.error('[onlyfans:webhook] ONLYFANSAPI_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { secret } = await context.params;
  // 404, not 401: never confirm to a prober that this endpoint exists.
  if (!timingSafeEqual(secret, configured)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rawBody = await request.text();
  const client = getOnlyFansClient();

  if (!client.verifyWebhookSignature(rawBody, request.headers, configured)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = client.parseWebhookEvent(payload);
  if (!event) {
    // Unmodelled event (PPV unlock, subscription) or an unrecognised shape.
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await recordLiveMessage(event.accountId, event.message, {
      unread: event.inbound ? 'increment' : undefined,
    });
  } catch (error) {
    console.error('[onlyfans:webhook] Failed to record message', error);
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
