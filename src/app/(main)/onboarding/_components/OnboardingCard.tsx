"use client";

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
 * The signed-in user's avatar. Shared by the header strip and the welcome step's
 * inline heading treatment so a single account identity renders identically in
 * both places.
 */
export function UserAvatar({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  const { userData } = useUserData();
  const name = userData?.displayName || userData?.firstName || '';

  return (
    <Avatar size={size} className={className} aria-hidden="true">
      {userData?.photoURL && <AvatarImage src={userData.photoURL} alt="" />}
      <AvatarFallback
        style={{ background: getAvatarColor(name || 'User'), color: '#fff' }}
        className={size === 'lg' ? 'text-sm' : 'text-[10px]'}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** One dot per onboarding page: filled behind you, Action Blue on you, hairline ahead. */
function ProgressDots({ step }: { step: OnboardingStepIndex }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'ahead';
        return (
          <li key={s.path} className="flex items-center">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'block size-1.5 rounded-full transition-colors duration-[120ms] ease-out',
                state === 'done' && 'bg-white/45',
                state === 'current' && 'bg-[#3b82f6] ring-4 ring-[#3b82f6]/15',
                state === 'ahead' && 'bg-white/12'
              )}
            />
            <span className="sr-only">
              {`Step ${i + 1} of ${ONBOARDING_STEPS.length}: ${s.label}${
                state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ''
              }`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface OnboardingCardProps {
  /** Zero-based index into ONBOARDING_STEPS — drives the dot rail. */
  step: OnboardingStepIndex;
  children: React.ReactNode;
  /** The form step needs more room than the narrative ones. */
  width?: 'default' | 'wide';
  /**
   * The welcome step renders identity inside its own heading ("Welcome to Bluu
   * Backend <avatar>"), so it suppresses the header strip to avoid two avatars.
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
  const { userData } = useUserData();
  const name = userData?.displayName || userData?.firstName || '';

  return (
    <div
      style={SURFACE}
      className={cn(
        'w-full rounded-xl border',
        width === 'wide' ? 'max-w-2xl' : 'max-w-lg'
      )}
    >
      {/* Header: progress left, identity right */}
      <div
        className="flex items-center justify-between gap-4 border-b px-6 py-4 sm:px-8"
        style={{ borderColor: HAIRLINE }}
      >
        <ProgressDots step={step} />

        {identity === 'strip' && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-zinc-400">{name}</span>
            <UserAvatar size="sm" />
          </div>
        )}
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
