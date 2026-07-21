"use client";

import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingCard from '../_components/OnboardingCard';

/**
 * What actually happens next, in order. The wait is the weakest moment in the
 * flow — the user finishes a long form and then can't use the app — so the
 * state is shown rather than described, which turns a dead end into progress.
 * Tones follow the semantic palette: green complete, orange awaiting, zinc idle.
 */
const NEXT_STEPS = [
  {
    label: 'Details submitted',
    status: 'Done',
    dot: 'bg-green-400',
    text: 'text-green-400',
    live: false,
    hint: null,
  },
  {
    label: 'Admin review',
    status: 'In progress',
    dot: 'bg-orange-400',
    text: 'text-orange-400',
    live: true,
    // True at this point: adminNewUserAlert fans out to every admin at signup.
    hint: 'Your managers have been notified.',
  },
  {
    label: 'Workspace access',
    status: 'Pending',
    dot: 'bg-zinc-600',
    text: 'text-zinc-500',
    live: false,
    hint: null,
  },
] as const;

export default function OnboardingDonePage() {
  const router = useRouter();

  return (
    <OnboardingCard step={5}>
      <div className="flex flex-col items-center text-center">
        {/* The one celebratory beat in the app. Green is semantic here. */}
        <span
          className="onboard-seal flex size-14 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10"
          aria-hidden="true"
        >
          <Check className="onboard-tick size-7 text-green-400" strokeWidth={2.5} />
        </span>

        <h1
          className="onboard-rise mt-5 text-lg font-semibold text-balance text-white"
          style={{ animationDelay: '120ms' }}
        >
          Your information has been received!
        </h1>

        <p
          className="onboard-rise mx-auto mt-3 max-w-[58ch] text-sm leading-relaxed text-pretty text-zinc-400"
          style={{ animationDelay: '180ms' }}
        >
          You are currently not assigned to any group until an admin reviews your information.
          Once you are assigned to a group, you will have access to your workspace. Check back
          soon!
        </p>
      </div>

      <ol
        className="onboard-rise mt-7 overflow-hidden rounded-lg border"
        style={{
          background: 'rgba(255,255,255,0.025)',
          borderColor: 'rgba(255,255,255,0.07)',
          animationDelay: '260ms',
        }}
      >
        {NEXT_STEPS.map(({ label, status, dot, text, live, hint }, i) => (
          <li
            key={label}
            className={i > 0 ? 'border-t' : undefined}
            style={i > 0 ? { borderColor: 'rgba(255,255,255,0.07)' } : undefined}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${dot} ${live ? 'onboard-pending' : ''}`}
                />
                <span className="truncate text-sm text-zinc-300">{label}</span>
              </div>
              <span className={`shrink-0 text-xs font-medium ${text}`}>{status}</span>
            </div>
            {/* pl-8 aligns the hint with the label: px-4 (16) + dot (6) + gap (10). */}
            {hint && <p className="pr-4 pb-3 pl-8 text-xs text-zinc-500">{hint}</p>}
          </li>
        ))}
      </ol>

      <Button
        onClick={() => router.push('/')}
        // `transition-all` already comes from buttonVariants — adding
        // `transition-transform` here would override it and kill the hover fade.
        className="onboard-rise mt-6 w-full active:scale-[0.98]"
        style={{ animationDelay: '340ms' }}
      >
        Go to my workspace
      </Button>
    </OnboardingCard>
  );
}
