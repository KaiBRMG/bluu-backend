import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { openByToken } from '@/lib/services/creatorOnboardingService';
import { STAGE_GROUND } from '@/app/model-submissions/_lib/theme';
import { OnboardingApp } from '../_components/OnboardingApp';

/**
 * The personal onboarding link.
 *
 * A server component that resolves the token through the service directly —
 * there is no public GET route to rate-limit, and nothing about the record is
 * serialised to the client except what `openByToken` chooses to project (name,
 * track, status, answers, cursor; never the email, the token hash or the
 * reviewer). The token in the path is the access control.
 *
 * Under Cache Components an uncached read must sit inside `<Suspense>`, so
 * `params` and the Firestore read live in `JoinContent`, never in the default
 * export (same split as `/s/[shareId]`). The consequence is the same too: a
 * dead link renders not-found with a 200, which only link checkers notice.
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main translate="no" className="notranslate min-h-dvh text-white" style={STAGE_GROUND}>
      <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
        <JoinContent params={params} />
      </Suspense>
    </main>
  );
}

async function JoinContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const onboarding = await openByToken(token);
  if (!onboarding) notFound();
  return <OnboardingApp token={token} initial={onboarding} />;
}
