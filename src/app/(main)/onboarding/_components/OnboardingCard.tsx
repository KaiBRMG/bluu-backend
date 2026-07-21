"use client";

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { clearPermissionsCache } from '@/lib/permissionsCache';
import { clearLoginSession } from '@/lib/loginSession';
import { auth } from '@/firebase-config';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import { ONBOARDING_STEPS, type OnboardingStepIndex } from '../steps';

/**
 * The card surface. Opaque — DESIGN.md's translucent overlay recipe assumes the
 * near-black canvas behind it; over the login photo it would let the image show
 * through and drop body text below the 4.5:1 contrast floor.
 */
const SURFACE = {
  background: '#171717',
  borderColor: 'rgba(255,255,255,0.07)',
} as const;

const HAIRLINE = 'rgba(255,255,255,0.07)';

/** How long sign-out will wait on the clock-out flush before giving up on it. */
const SIGN_OUT_FLUSH_TIMEOUT_MS = 2500;

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

/**
 * Onboarding is the one authenticated surface with no sidebar, so without this
 * a user who signed in with the wrong account would be stuck with no way out.
 * Mirrors `NavUser`'s sign-out exactly — including the clock-out flush, so the
 * two paths can't drift (see time-tracking.md: leaving without pressing Clock
 * Out otherwise leaves the session open server-side).
 */
function SignOutButton() {
  const { clockOutAndFlush } = useTimeTrackingContext();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);

    // Time-boxed. The flush awaits a Firebase token refresh and a network call,
    // either of which can hang offline — and sign-out is the escape hatch from a
    // wedged flow, so bookkeeping must never be able to hold it up.
    try {
      await Promise.race([
        clockOutAndFlush(),
        new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_FLUSH_TIMEOUT_MS)),
      ]);
    } catch (error) {
      console.error('[Onboarding] Clock-out on sign out failed (continuing):', error);
    }

    // Clear local session state BEFORE signing out, and never let a failure here
    // stop the rest. With the login marker gone, even a failed `signOut()` leaves
    // the next boot in a state the incomplete-onboarding discard resolves into
    // the login screen.
    try {
      clearPermissionsCache();
      localStorage.removeItem('sessionToken');
      clearLoginSession();
    } catch (error) {
      console.error('[Onboarding] Clearing local session state failed:', error);
    }

    try {
      await auth.signOut();
    } catch (error) {
      console.error('[Onboarding] Sign out failed; reloading anyway:', error);
    }

    // A full document load, not a router push: it rebuilds the whole tree, so a
    // stuck effect, a wedged provider, or a permanently-null `userData` in the
    // onboarding flow cannot keep the user pinned to this screen. Signed out,
    // AuthWrapper renders Login.
    window.location.assign('/');
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={handleSignOut}
      disabled={signingOut}
      className="text-zinc-500 hover:text-zinc-300"
    >
      <LogOut aria-hidden="true" />
      {signingOut ? 'Signing out…' : 'Sign out'}
    </Button>
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
    // A flex column capped at the viewport: header and footer hold their size,
    // the body takes what's left. Short steps size to their content; the details
    // step hits the cap and scrolls inside instead of growing the page.
    <div
      style={SURFACE}
      className={cn(
        'flex max-h-full w-full flex-col overflow-hidden rounded-xl border',
        width === 'wide' ? 'max-w-2xl' : 'max-w-lg'
      )}
    >
      {/* Header: brand mark centred, then progress left / identity right */}
      <div className="shrink-0 border-b px-6 py-5 sm:px-8" style={{ borderColor: HAIRLINE }}>
        {/* Sign-out is absolutely placed so the wordmark stays optically centred
            in the card rather than being pushed off-centre by it. */}
        <div className="relative">
          {/* The wordmark is the one sanctioned non-Avatar image in the system. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/bluu_long.svg" alt="Bluu" className="mx-auto h-5 w-auto" />
          <div className="absolute inset-y-0 right-0 flex items-center">
            <SignOutButton />
          </div>
        </div>

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

      {/* `min-h-0` lets this shrink below its content so a child marked
          `flex-1 overflow-y-auto` (the details form) becomes the scroller. */}
      <div className="flex min-h-0 flex-1 flex-col px-6 py-7 sm:px-8">{children}</div>

      {footer && (
        <div
          className="shrink-0 border-t px-6 py-4 sm:px-8"
          style={{ borderColor: HAIRLINE }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
