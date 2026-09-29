import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { saveAnswers } from '@/lib/services/creatorOnboardingService';

/**
 * PUBLIC — autosave for the personal onboarding form.
 *
 * The 160-bit secret in the path IS the access control (the same posture as
 * `/p/[shareId]` and `/s/[shareId]`): it is compared, hashed and timing-safe,
 * against the one record the id half of the token names. It can only ever
 * write that record's own answers, only known question ids, only strings under
 * each question's cap (`sanitisePatch`), and nothing once the form is complete.
 *
 * Body: `{ answers: Record<string,string>, cursor?: { chapter, screen } }`,
 * capped at 64KB — the whole form fits comfortably inside that.
 *
 * `keepalive` requests from `pagehide` also land here, so this must stay
 * cheap: one read, one write.
 *
 * Not cacheable: a per-link write.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = read.body as { answers?: unknown; cursor?: unknown } | null;

  try {
    const result = await saveAnswers(token, body?.answers, body?.cursor);
    if (!result.ok) {
      return result.reason === 'locked'
        ? NextResponse.json({ error: 'This form has already been submitted.' }, { status: 409 })
        : NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[join/save]', error);
    return NextResponse.json({ error: 'Could not save. Retrying…' }, { status: 500 });
  }
}
