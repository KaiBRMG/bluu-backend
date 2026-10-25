import { NextRequest, NextResponse, after } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { sendEmail } from '@/lib/email/resend';
import { trainingCodeEmail } from '@/lib/email/templates';
import {
  clientIp,
  consumeRate,
  emailHashFor,
  hashIp,
  issueCode,
} from '@/lib/services/trainingAuthService';
import { isApproved } from '@/lib/services/trainingService';

/**
 * PUBLIC — step one of `/training`: an email address in, a 6-digit code out.
 *
 * THE RESPONSE NEVER SAYS WHETHER THE ADDRESS IS APPROVED. Every well-formed
 * request that clears the limits gets the same `{ ok: true }`, and the lookup
 * and the send happen in `after()` so the two cases also take the same time.
 * Without that, this endpoint is an oracle for who is on a training list.
 *
 * Abuse layers, in order (each is cheap, and the cheap ones run first):
 *   - honeypot + a minimum fill time answer a silent 200 (a refusal would teach
 *     a script what tripped it);
 *   - a per-IP and a per-address ceiling — the address limit counts requests,
 *     not approved requests, so it leaks nothing either;
 *   - a resend cooldown inside `issueCode`.
 *
 * Not cacheable: a per-request write.
 */
const MAX_BODY_BYTES = 2 * 1024;
const MIN_FILL_MS = 1_200;
const HOUR = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { email?: unknown; website?: unknown; elapsedMs?: unknown };

  const ok = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });

  if (typeof body.website === 'string' && body.website.trim() !== '') return ok;
  if (typeof body.elapsedMs === 'number' && body.elapsedMs < MIN_FILL_MS) return ok;

  const hashed = typeof body.email === 'string' && body.email.length <= 254 ? emailHashFor(body.email) : null;
  if (!hashed) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  try {
    const ipHash = hashIp(clientIp(request.headers));
    if (!(await consumeRate('code-ip', ipHash, 60, HOUR))) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }
    if (!(await consumeRate('code-email', hashed.emailHash, 6, HOUR))) {
      return NextResponse.json({ error: 'Too many codes requested. Try again in an hour.' }, { status: 429 });
    }

    const { emailHash } = hashed;
    const to = body.email as string;
    after(async () => {
      try {
        if (!(await isApproved(emailHash))) return;
        const code = await issueCode(emailHash);
        if (!code) return; // inside the resend cooldown
        const mail = trainingCodeEmail(code);
        await sendEmail({
          to: to.trim(),
          ...mail,
          tags: [{ name: 'kind', value: 'training-code' }],
        });
      } catch (error) {
        console.error('[training/request-code]', error);
      }
    });
    return ok;
  } catch (error) {
    console.error('[training/request-code]', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
