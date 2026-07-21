"use client";

import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingCard from '../_components/OnboardingCard';

export default function OnboardingDonePage() {
  const router = useRouter();

  return (
    <OnboardingCard step={5}>
      <div className="flex items-center gap-2.5">
        {/* Green means "succeeded" here — a semantic use, not decoration. */}
        <CheckCircle2 className="shrink-0 text-green-400" size={18} aria-hidden="true" />
        <h1 className="text-lg font-semibold text-white">Your information has been received!</h1>
      </div>

      <p className="mt-4 max-w-[65ch] text-sm leading-relaxed text-zinc-400">
        You are currently not assigned to any group until an admin reviews your information.
        Once you are assigned to a group, you will have access to your workspace. Check back
        soon!
      </p>

      <Button onClick={() => router.push('/')} className="mt-7 w-full">
        Go to my workspace
      </Button>
    </OnboardingCard>
  );
}
