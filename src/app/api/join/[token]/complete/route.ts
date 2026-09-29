import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { completeByToken } from '@/lib/services/creatorOnboardingService';
import { notifyPageHolders } from '@/lib/services/pageNotify';

/**
 * PUBLIC — submits the personal onboarding form. Same token posture as the
 * autosave route beside it.
 *
 * Every required answer is re-checked here against the shared question model;
 * the browser's check is convenience. On success the record locks (later saves
 * 409) and everyone who can open Creator Portal → Onboarding is notified, in
 * the app and on Telegram — the handle they need to take it from here is in
 * the notification's destination.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = read.body as { answers?: unknown } | null;

  try {
    const result = await completeByToken(token, body?.answers);
    if (!result.ok) {
      if (result.reason === 'incomplete') {
        return NextResponse.json(
          { error: 'A few answers still need you.', fields: result.fields },
          { status: 400 },
        );
      }
      return result.reason === 'locked'
        ? NextResponse.json({ error: 'This form has already been submitted.' }, { status: 409 })
        : NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 });
    }

    // Notify the people who act on it. Best effort: the creator's submission is
    // already safe, and a notification failure must not tell them it wasn't.
    try {
      await notifyPageHolders(
        'creators-onboarding',
        notifications.creatorOnboardingCompleted(result.name, result.stageName),
      );
    } catch (error) {
      console.error('[join/complete] notify failed', error);
    }

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[join/complete]', error);
    return NextResponse.json({ error: 'Could not submit. Please try again.' }, { status: 500 });
  }
}
