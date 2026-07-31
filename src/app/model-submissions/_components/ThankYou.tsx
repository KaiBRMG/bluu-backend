'use client';

import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Check } from 'lucide-react';
import { AZURE, AZURE_DEEP, AZURE_INK } from '../_lib/theme';

/**
 * The applicant's completion moment.
 *
 * Structurally the same beat as `/onboarding/done` — a once-ever screen for a
 * person who crosses it exactly once — so it deliberately reuses that screen's
 * seal / tick / rise vocabulary rather than inventing a second one. What's new
 * here is the stage bloom behind the seal and a single confetti burst, both
 * scoped to this surface.
 *
 * Every base style is the FINAL state, so the screen renders correctly if the
 * animation never runs; the global `prefers-reduced-motion` reset in
 * globals.css collapses all of it, and the confetti is skipped outright.
 */
export function ThankYou({ name }: { name: string }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 76,
        startVelocity: 38,
        gravity: 0.9,
        ticks: 180,
        origin: { y: 0.42 },
        colors: [AZURE, AZURE_DEEP, '#ffffff', '#9fe5ff'],
        disableForReducedMotion: true,
      });
    }, 420);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <div className="relative grid place-items-center">
        {/* The stage light, blooming out from behind the seal. */}
        <span
          className="stage-bloom pointer-events-none absolute size-52 rounded-full"
          style={{
            background: `radial-gradient(circle, ${AZURE}33 0%, transparent 68%)`,
          }}
          aria-hidden
        />
        <span
          className="onboard-seal relative grid size-20 place-items-center rounded-full"
          style={{ backgroundColor: AZURE }}
        >
          <Check className="onboard-tick size-10 stroke-[2.5]" style={{ color: AZURE_INK }} aria-hidden />
        </span>
      </div>

      <h1
        className="onboard-rise mt-9 max-w-[16ch] text-4xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance text-white sm:text-5xl"
        style={{ animationDelay: '120ms' }}
      >
        Thank you{name ? `, ${name}` : ''}!
      </h1>

      <p
        className="onboard-rise mt-4 max-w-[34ch] text-lg leading-relaxed text-white/70"
        style={{ animationDelay: '200ms' }}
      >
        Your submission has been received.
      </p>

      <p
        className="onboard-rise mt-8 max-w-[42ch] text-sm leading-relaxed text-white/50"
        style={{ animationDelay: '280ms' }}
      >
        Our team reviews every application by hand. If you&rsquo;re a fit, we&rsquo;ll reach out on
        the contact you gave us. You can close this page now.
      </p>

      <div className="onboard-rise mt-14" style={{ animationDelay: '360ms' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-5 w-auto opacity-45" />
      </div>
    </div>
  );
}
