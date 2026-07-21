"use client";

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import { ONBOARDING_STEPS, type OnboardingStepIndex } from '../steps';

/** The card interior surface — the overlay recipe from DESIGN.md §4, never a shadow. */
const SURFACE = {
  background: 'rgba(255,255,255,0.025)',
  borderColor: 'rgba(255,255,255,0.07)',
} as const;

const HAIRLINE = 'rgba(255,255,255,0.07)';

/**
 * The user's full name — `firstName lastName` from the user doc. `displayName`
 * is only ever the first name (see `ensureUserExists`), so it is the fallback,
 * not the source.
 *
 * For **display text only**. Never seed an avatar from this — see `useAvatarSeed`.
 */
export function useFullName(): string {
  const { userData } = useUserData();
  if (!userData) return '';
  const full = `${userData.firstName ?? ''} ${userData.lastName ?? ''}`.trim();
  return full || userData.displayName || '';
}

/**
 * The string every avatar in the app is derived from. Must stay byte-identical
 * to `AppLayout`'s `userData.name`, because `getAvatarColor` **hashes** it:
 * seeding from the full name instead of `displayName` changes the initials
 * ("SP" vs "S") *and* the colour, so the same person would visibly change
 * appearance crossing from onboarding into the app.
 */
export function useAvatarSeed(): string {
  const { userData } = useUserData();
  const { user } = useAuth();
  return userData?.displayName || user?.displayName || 'User';
}

/**
 * The signed-in user's avatar. Shared by the header strip, the welcome step, and
 * the profile step so one account identity renders identically everywhere.
 */
export function UserAvatar({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  const { userData } = useUserData();
  const seed = useAvatarSeed();

  // Until the user doc arrives, `getInitials` would render a placeholder "?" on
  // a hashed colour — a visible flash of the wrong identity. Hold a skeleton.
  if (!userData) {
    return (
      <Skeleton
        className={cn(
          'shrink-0 rounded-full',
          size === 'lg' ? 'size-10' : size === 'default' ? 'size-8' : 'size-6',
          className
        )}
      />
    );
  }

  return (
    // Colour is set on the root too, matching NavUser — it shows through while
    // a photo is still decoding.
    <Avatar
      size={size}
      className={className}
      style={{ background: getAvatarColor(seed) }}
      aria-hidden="true"
    >
      {userData.photoURL && <AvatarImage src={userData.photoURL} alt="" />}
      <AvatarFallback
        style={{ background: getAvatarColor(seed), color: '#fff' }}
        className={size === 'lg' ? 'text-sm' : 'text-[10px]'}
      >
        {getInitials(seed)}
      </AvatarFallback>
    </Avatar>
  );
}

/** One dot per onboarding page: filled behind you, Action Blue on you, hairline ahead. */
function ProgressDots({ step }: { step: OnboardingStepIndex }) {
  return (
    <>
      {/* One spoken summary. Labelling each of the six dots individually made a
          screen reader recite the entire flow on every page. */}
      <p className="sr-only">
        {`Step ${step + 1} of ${ONBOARDING_STEPS.length}: ${ONBOARDING_STEPS[step].label}`}
      </p>
      <ol className="flex items-center gap-2" aria-hidden="true">
        {ONBOARDING_STEPS.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'ahead';
          return (
            <li
              key={s.path}
              className={cn(
                'size-1.5 rounded-full transition-colors duration-[120ms] ease-out',
                state === 'done' && 'bg-white/45',
                state === 'current' && 'bg-[#3b82f6] ring-4 ring-[#3b82f6]/15',
                state === 'ahead' && 'bg-white/12'
              )}
            />
          );
        })}
      </ol>
    </>
  );
}

interface OnboardingCardProps {
  /** Zero-based index into ONBOARDING_STEPS — drives the dot rail. */
  step: OnboardingStepIndex;
  children: React.ReactNode;
  /** The form step needs more room than the narrative ones. */
  width?: 'default' | 'wide';
  /**
   * The welcome step presents identity itself, centred under its heading, so it
   * passes `none` to suppress the header strip and avoid a second avatar.
   */
  identity?: 'strip' | 'none';
  /** Rendered flush to the card's bottom edge, above the padding — used for sticky footers. */
  footer?: React.ReactNode;
}

export default function OnboardingCard({
  step,
  children,
  width = 'default',
  identity = 'strip',
  footer,
}: OnboardingCardProps) {
  const name = useFullName();

  return (
    <div
      style={SURFACE}
      className={cn(
        'w-full rounded-xl border',
        width === 'wide' ? 'max-w-2xl' : 'max-w-lg'
      )}
    >
      {/* Header: brand mark centred, then progress left / identity right */}
      <div className="border-b px-6 py-5 sm:px-8" style={{ borderColor: HAIRLINE }}>
        {/* The wordmark is the one sanctioned non-Avatar image in the system. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_long.svg" alt="Bluu" className="mx-auto h-5 w-auto" />

        <div className="mt-5 flex items-center justify-between gap-4">
          <ProgressDots step={step} />

          {identity === 'strip' && (
            <div className="flex min-w-0 items-center gap-2">
              {name ? (
                <span className="truncate text-xs font-medium text-zinc-400">{name}</span>
              ) : (
                <Skeleton className="h-3 w-24" />
              )}
              <UserAvatar size="sm" />
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-7 sm:px-8">{children}</div>

      {footer && (
        <div
          className="border-t px-6 py-4 sm:px-8"
          style={{ borderColor: HAIRLINE }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
