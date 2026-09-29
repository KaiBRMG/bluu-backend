'use client';

import { IconCheck, IconLock } from '@tabler/icons-react';
import { ArrowRight } from 'lucide-react';
import type { Chapter } from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import { AZURE, AZURE_INK } from '@/app/model-submissions/_lib/theme';
import { ActionBar, PrimaryButton } from './OnboardingApp';
import { Pass } from './Pass';

interface WelcomeProps {
  name: string;
  firstName: string;
  passNo: string;
  issuedAt: string | null;
  /** Chapters already filtered to the creator's track. */
  chapters: Chapter[];
  /** `chapterProgress` per chapter, computed once by the parent. */
  chapterStats: { complete: boolean }[];
  /** Has been here before and made real progress — the copy says "welcome back". */
  returning: boolean;
  ratio: number;
  totalMinutes: number;
  onBegin: () => void;
}

/**
 * The landing: the moment the approved applicant opens their link.
 *
 * The emotional job is "you made it", and the pass does it — their own name on a
 * credential, handed over as the page loads. The words beside it stay factual:
 * every application IS reviewed by hand, and this link IS theirs alone. That is
 * the exclusivity, and it needs no invented number to land.
 *
 * The practical job is "this won't take long": the three sets are listed with
 * honest minutes, and "saves as you go" is said before they start, not
 * discovered after they have lost something.
 */
export function Welcome({
  name,
  firstName,
  passNo,
  issuedAt,
  chapters,
  chapterStats,
  returning,
  ratio,
  totalMinutes,
  onBegin,
}: WelcomeProps) {
  const pct = Math.round(ratio * 100);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="pt-6 sm:pt-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-8 w-auto" />
      </header>

      <div className="grid flex-1 items-center gap-8 pt-6 pb-44 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16 lg:pt-4 lg:pb-16">
        {/* The pass leads on a phone (it IS the moment); sits beside the copy on
            a desk. ~66% wide on a phone, not larger: any bigger and the setlist
            starts below the first viewport. */}
        <div className="mx-auto w-[min(66vw,17rem)] lg:order-2 lg:w-full lg:max-w-[26rem]">
          <Pass name={name} passNo={passNo} issuedAt={issuedAt} />
        </div>

        <div className="flex flex-col lg:order-1">
          <h1 className="text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
            {returning ? `Welcome back, ${firstName}.` : `You’re in, ${firstName}.`}
          </h1>

          <p className="mt-4 max-w-[44ch] text-lg leading-relaxed text-white/75">
            {returning ? `You’re ${pct}% there, and every answer is saved.` : 'Every application is reviewed by hand. Yours made it.'}
          </p>

          <ol className="mt-8 flex flex-col" aria-label="Your onboarding, in three sets">
            {chapters.map((c, i) => {
              const p = chapterStats[i];
              return (
                <li
                  key={c.id}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-white/[0.08] py-4 last:border-b"
                >
                  <span
                    className={cn(
                      'grid size-7 place-items-center self-center rounded-full text-sm font-semibold tabular-nums',
                      !p.complete && 'text-white/75 ring-1 ring-white/20',
                    )}
                    style={p.complete ? { backgroundColor: AZURE, color: AZURE_INK } : undefined}
                    aria-hidden
                  >
                    {p.complete ? <IconCheck className="size-4" /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-white">
                      {c.title}
                      {p.complete && <span className="sr-only"> — done</span>}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug text-white/65">{c.blurb}</p>
                  </div>
                  <span className="text-sm text-white/60 tabular-nums">{c.minutes} min</span>
                </li>
              );
            })}
          </ol>

          <p className="mt-5 hidden text-sm leading-relaxed text-white/65 lg:block">
            About {totalMinutes} minutes, and it saves as you go — close it and come back any time from the same link.
          </p>

          {/* On a desk the action sits with the copy; on a phone it is pinned to the thumb. */}
          <div className="mt-8 hidden lg:block">
            <BeginButton returning={returning} onBegin={onBegin} />
          </div>

          <p className="mt-6 flex items-start gap-2 text-sm leading-snug text-white/60">
            <IconLock className="mt-0.5 size-4 shrink-0" aria-hidden />
            This link is yours alone, and only the Bluu Rock team sees your answers.
          </p>
        </div>
      </div>

      <ActionBar className="lg:hidden">
        {/* The honest-minutes promise, on screen at the moment of tapping. */}
        <p className="text-center text-xs text-white/65 tabular-nums">
          About {totalMinutes} min · three sets · saves as you go
        </p>
        <BeginButton returning={returning} onBegin={onBegin} />
      </ActionBar>
    </div>
  );
}

function BeginButton({ returning, onBegin }: { returning: boolean; onBegin: () => void }) {
  return (
    <PrimaryButton onClick={onBegin} className="w-full px-7 lg:w-auto lg:flex-none">
      {returning ? 'Pick up where you left off' : 'Begin onboarding'}
      <ArrowRight className="size-4" />
    </PrimaryButton>
  );
}
