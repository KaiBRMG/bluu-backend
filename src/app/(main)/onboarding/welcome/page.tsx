"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import OnboardingCard, { UserAvatar } from '../_components/OnboardingCard';

export default function WelcomePage() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const name = userData?.displayName || userData?.firstName || '';

  const handleNext = async () => {
    if (!accepted || !user || loading) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hasAcceptedTerms: true }),
      });
      if (!res.ok) throw new Error('Failed to record your acceptance');
      router.push('/onboarding/permissions');
    } catch (err) {
      console.error('[WelcomePage] Failed to accept terms:', err);
      toast.error("Couldn't save your acceptance. Check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <OnboardingCard step={0} identity="none">
      <h1 className="text-lg font-semibold text-white">
        {/* The inline avatar is this step's identity treatment — which is why the
            header strip is suppressed above (no duplicate avatar). */}
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 align-middle">
          Welcome to Bluu Backend
          <UserAvatar size="default" />
        </span>
      </h1>

      {name && <p className="mt-1.5 text-sm text-zinc-400">Signed in as {name}</p>}

      <p className="mt-5 max-w-[65ch] text-sm leading-relaxed text-zinc-400">
        Bluu Backend is the internal management platform for Bluu Rock MGMT. Before you
        start, please review and accept the terms of use.
      </p>

      <div className="mt-7 flex items-start gap-3">
        <Checkbox
          id="terms"
          checked={accepted}
          onCheckedChange={(checked) => setAccepted(checked === true)}
          className="mt-0.5"
        />
        <label htmlFor="terms" className="cursor-pointer text-sm text-zinc-400 select-none">
          I accept the{' '}
          <a
            /* Opens in the system browser: Electron's setWindowOpenHandler routes
               target=_blank through shell.openExternal. /terms is allowlisted in
               middleware.ts so it resolves outside the desktop app. */
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline underline-offset-2 transition-colors hover:text-zinc-300"
          >
            terms of use
          </a>
        </label>
      </div>

      <Button onClick={handleNext} disabled={!accepted || loading} className="mt-7 w-full">
        {loading ? 'Please wait…' : 'Next'}
      </Button>
    </OnboardingCard>
  );
}
