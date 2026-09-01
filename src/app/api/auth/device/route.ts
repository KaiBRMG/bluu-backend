import { NextRequest, NextResponse } from 'next/server';
import { isValidDeviceId, lookupDeviceOwner } from '@/lib/services/sessionService';

/**
 * POST /api/auth/device  — **unauthenticated.**
 *
 * "Is this browser one of ours?" Answers with a bare boolean and nothing else.
 *
 * The public share page (`/p/[shareId]`) uses it to decide whether to present
 * "Open in Bluu Backend" as the primary action. It is the only place a caller
 * with no session may consult the device index, and it is deliberately the
 * narrowest possible question:
 *
 *  • **No PII leaves this route.** Not a name, not an email, not a uid. A device
 *    id is a random UUID held only by the browser that minted it, so a `true`
 *    tells its owner something they already know — and tells anyone who stole
 *    the id nothing they can act on.
 *  • **It grants nothing.** Being recognised only changes which button is
 *    emphasised. Every actual read of prompt data is authorised elsewhere.
 *  • Deactivated and archived users resolve to `false`, because
 *    `lookupDeviceOwner` re-checks the user doc rather than trusting the index.
 *
 * Rate limited per id: unauthenticated, and each call costs a doc get.
 */

const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    if (attempts.size > 500) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
    }
    return false;
  }

  record.count += 1;
  return record.count > MAX_ATTEMPTS_PER_WINDOW;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const deviceId = (body as { deviceId?: unknown }).deviceId;

    // A malformed or absent id is simply "not recognised" — never an error the
    // caller can distinguish, since the caller is the open internet.
    if (!isValidDeviceId(deviceId)) {
      return NextResponse.json({ known: false });
    }
    if (isRateLimited(deviceId)) {
      return NextResponse.json({ known: false }, { status: 429 });
    }

    const uid = await lookupDeviceOwner(deviceId);
    return NextResponse.json({ known: uid !== null });
  } catch (err) {
    console.error('[auth/device] error:', err);
    // Fail closed: an error is not evidence the visitor is staff.
    return NextResponse.json({ known: false });
  }
}
