import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { TOTAL_MINUTES } from '@/lib/creatorOnboarding';
import { sendEmail } from '@/lib/email/resend';
import { greetingName, welcomeEmail } from '@/lib/email/templates';
import { InviteRefused, issueInvite, recordInviteEmail } from '@/lib/services/creatorOnboardingService';

/**
 * Sends the "Welcome to BLUU ROCK 🎉" email with the applicant's personal
 * onboarding link — the first send, or a re-send (which rotates the link).
 *
 * Tier 2. Callable from either surface that offers it: the approval card on
 * Model Submissions, and "Send new link" on Onboarding — so holding either page
 * permission is enough. Both pages already expose this applicant's details to
 * the caller, so neither widens what they can reach.
 *
 * Idempotency: the Resend key is `onboarding-invite/<id>/<n>`, so a retried
 * request inside 24h cannot send the same invite twice; a deliberate re-send
 * increments `n` and is a new message.
 */
const PAGES = ['apps-model-submissions', 'creators-onboarding'] as const;

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await checkPageAccess(token.uid, PAGES);
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => ({}));
    const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : '';
    if (!/^[a-f0-9]{32}$/.test(submissionId)) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    const invite = await issueInvite(submissionId, token.uid);
    const email = welcomeEmail(greetingName(invite.submission.name), invite.url, TOTAL_MINUTES);
    const emailId = await sendEmail({
      to: invite.submission.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `onboarding-invite/${submissionId}/${invite.inviteCount}`,
      tags: [{ name: 'category', value: 'onboarding_invite' }],
    });
    await recordInviteEmail(submissionId, emailId).catch(() => {});

    return NextResponse.json({ ok: true, to: invite.submission.email, resent: invite.inviteCount > 1 });
  } catch (error) {
    if (error instanceof InviteRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleApiError(error, 'creator-onboarding/invite');
  }
});
