"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import OnboardingCard, { UserAvatar, useFullName } from '../_components/OnboardingCard';

export default function WelcomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const name = useFullName();

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
    // The header strip is suppressed: this step presents identity itself, below
    // the heading, so there is never a second avatar on screen.
    <OnboardingCard step={0} identity="none">
      <h1 className="text-center text-lg font-semibold text-balance text-white">
        Welcome to Bluu Backend
      </h1>

      <div className="mt-4 flex flex-col items-center gap-2">
        <UserAvatar size="lg" />
        {/* Reserve the line while the user doc loads so the copy below doesn't jump. */}
        {name ? (
          <p className="text-sm font-medium text-white">{name}</p>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
      </div>

      <p className="mx-auto mt-6 max-w-[60ch] text-center text-sm leading-relaxed text-pretty text-zinc-400">
        Bluu Backend is the internal management platform for Bluu Rock MGMT. Before you
        start, please review and accept the terms of use.
      </p>

      <div className="mt-7 flex items-start justify-center gap-3">
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
        {loading ? 'Saving…' : 'Next'}
      </Button>
    </OnboardingCard>
  );
}
