import { NextRequest, NextResponse } from 'next/server';
import { resendSender } from '@/lib/email/resend';
import { handleReceivedEmail } from '@/lib/services/creatorInquiryService';

/**
 * PUBLIC — Resend's `email.received` webhook for hello@bluurock.com.
 *
 * Authenticated by the Svix signature, verified over the RAW body (a parsed and
 * re-serialised body no longer matches the signature) with
 * `RESEND_WEBHOOK_SECRET`. Anything unsigned or mis-signed is a 400 before any
 * Firestore read or Resend call.
 *
 * Status codes are chosen for Svix's retry behaviour, which redelivers on any
 * non-2xx: a bad signature is 400 (never going to succeed), an event we do not
 * handle is 200 (nothing to retry), and only a failure to FETCH the email is a
 * 500 — the one case where trying again can help. Everything after the record
 * is written answers 200, because `creator-inquiries/{emailId}` makes a
 * redelivery a no-op anyway and a failed send is logged for a person to retry.
 *
 * Not cacheable: a webhook receiver.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[email/inbound] RESEND_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const payload = await request.text();
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = resendSender().webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  try {
    const outcome = await handleReceivedEmail(event.data.email_id);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    console.error('[email/inbound]', error);
    return NextResponse.json({ error: 'Could not process email' }, { status: 500 });
  }
}
