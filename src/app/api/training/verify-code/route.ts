import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  clientIp,
  consumeRate,
  emailHashFor,
  hashIp,
  mintCookie,
  verifyCode,
} from '@/lib/services/trainingAuthService';
import { isApproved } from '@/lib/services/trainingService';

/**
 * PUBLIC — step two: the emailed code in, a signed httpOnly cookie out.
 *
 * Every failure is the same message and status, whatever the cause (no such
 * code, wrong, expired, spent, or approval since withdrawn). The code itself is
 * capped at five guesses inside `verifyCode`; the per-IP ceiling here is the
 * backstop against one connection working through many addresses.
 *
 * Not cacheable: it sets a cookie.
 */
const MAX_BODY_BYTES = 2 * 1024;
const HOUR = 60 * 60 * 1000;
const REFUSED = { error: "That code isn't right or has expired." };

export async function POST(request: NextRequest) {
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { email?: unknown; code?: unknown };

  const hashed = typeof body.email === 'string' && body.email.length <= 254 ? emailHashFor(body.email) : null;
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!hashed || !/^\d{6}$/.test(code)) return NextResponse.json(REFUSED, { status: 400 });

  try {
    if (!(await consumeRate('verify-ip', hashIp(clientIp(request.headers)), 120, HOUR))) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }
    if (!(await verifyCode(hashed.emailHash, code)) || !(await isApproved(hashed.emailHash))) {
      return NextResponse.json(REFUSED, { status: 400 });
    }

    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(COOKIE_NAME, mintCookie(hashed.emailHash), COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error('[training/verify-code]', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
