"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Checkbox } from '@/components/ui/checkbox';

const TERMS_URL = 'https://languid-syzygy-f45.notion.site/Bluu-Backend-31d6a3e187d980a0bd2efa816993e2e7?source=copy_link';

export default function WelcomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNext = async () => {
    if (!accepted || !user || loading) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hasAcceptedTerms: true }),
      });
      router.push('/onboarding/permissions');
    } catch (err) {
      console.error('[WelcomePage] Failed to accept terms:', err);
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 max-w-lg w-full text-center">
      <div className="flex justify-center mb-6">
        <img src="/logo/HQ2.png" alt="BluuRock" className="h-20 w-auto" />
      </div>

      <h1 className="text-2xl font-semibold text-white mb-4">Welcome to Bluu Backend</h1>

      <p className="text-zinc-400 text-sm leading-relaxed mb-10">
        Bluu Backend is an internal management platform developed and maintained by Bluu Rock MGMT. To get started, please review and accept the terms of use below.
      </p>

      <div className="flex items-center justify-center gap-3 mb-8">
        <Checkbox
          id="terms"
          checked={accepted}
          onCheckedChange={(checked) => setAccepted(checked === true)}
        />
        <label htmlFor="terms" className="text-zinc-400 text-sm cursor-pointer select-none">
          I accept the{' '}
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-white hover:text-zinc-300 transition-colors"
          >
            terms of use
          </a>
        </label>
      </div>

      <button
        onClick={handleNext}
        disabled={!accepted || loading}
        className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Please wait...' : 'Next'}
      </button>
    </div>
  );
}
