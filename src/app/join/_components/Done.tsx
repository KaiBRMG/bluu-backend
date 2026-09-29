'use client';

import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { IconBrandTelegram } from '@tabler/icons-react';
import { AZURE, AZURE_DEEP } from '@/app/model-submissions/_lib/theme';
import { Pass } from './Pass';

interface DoneProps {
  firstName: string;
  name: string;
  passNo: string;
  issuedAt: string | null;
  completedAt: string | null;
  telegram: string;
  /** True only in the moment of submitting — a revisit is quiet. */
  celebrate: boolean;
}

/**
 * The end of onboarding: the same pass they were handed on arrival, now
 * stamped "Onboarded". Closing the loop on the object they started with is the
 * whole celebration — plus one confetti burst, the same single burst the
 * application's thank-you screen uses, and only in the moment of sending.
 * Reopening the link later shows the stamped pass without the fanfare.
 */
export function Done({ firstName, name, passNo, issuedAt, completedAt, telegram, celebrate }: DoneProps) {
  useEffect(() => {
    if (!celebrate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 76,
        startVelocity: 38,
        gravity: 0.9,
        ticks: 180,
        origin: { y: 0.4 },
        colors: [AZURE, AZURE_DEEP, '#ffffff', '#9fe5ff'],
        disableForReducedMotion: true,
      });
    }, 620);
    return () => window.clearTimeout(timer);
  }, [celebrate]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="pt-6 sm:pt-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-8 w-auto" />
      </header>

      <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16">
        <div className="mx-auto w-[min(66vw,17rem)] lg:order-2 lg:w-full lg:max-w-[26rem]">
          <Pass name={name} passNo={passNo} issuedAt={issuedAt} stamped stampedAt={completedAt} arrive={false} />
        </div>

        <div className="flex flex-col lg:order-1">
          <h1 className="text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
            {celebrate ? `That’s everything, ${firstName}.` : `You’re all set, ${firstName}.`}
          </h1>
          <p className="mt-5 max-w-[44ch] text-lg leading-relaxed text-white/75">
            Your onboarding is with the Bluu Rock team. We’ll message you on Telegram to get you set up
            {telegram ? '' : ' — keep an eye out'}.
          </p>
          {/* Plain text, not a pill: nothing here is clickable. */}
          {telegram && (
            <p className="mt-5 flex items-center gap-2 text-base text-white/85">
              <IconBrandTelegram className="size-5 shrink-0" style={{ color: AZURE }} aria-hidden />
              <span>
                We’ll write to <span className="font-semibold text-white">@{telegram}</span>
              </span>
            </p>
          )}
          <p className="mt-8 text-sm leading-relaxed text-white/60">
            You can close this page. If something changes before we speak, just tell us on Telegram.
          </p>
        </div>
      </div>
    </div>
  );
}
