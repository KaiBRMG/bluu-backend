'use client';

import { useUserData } from '@/hooks/useUserData';
import { safeTimezone } from '@/lib/utils/timezone';

/**
 * The timezone to render times in, and whether the user actually chose it.
 *
 * ## Why this exists rather than `userData?.timezone ?? 'UTC'`
 *
 * `ensureUserExists` seeds `timezone: ''`, and only the onboarding profile step
 * fills it in — so an **empty string is a normal state**, not corruption. `??`
 * does not catch it because `''` is not nullish, and `Intl.DateTimeFormat`
 * throws `RangeError: Invalid time zone specified:` on it. That combination
 * crashed the CA dashboard for a user who had not set one.
 *
 * Every employee-facing surface that renders a time should read its timezone
 * from here. The `||` spelling also works, but it silently resolves to UTC and
 * tells nobody — which is the second half of the problem: a user with no
 * timezone is shown *every* time in the app in UTC, with no indication that the
 * numbers are not their local clock.
 *
 * `isConfigured` is what lets a surface say so. See `TimezoneNotice`.
 */

export interface ViewerTimezone {
  /** Always a valid IANA zone. Falls back to UTC. */
  timezone: string;
  /** False when the user has not set one and is therefore being shown UTC. */
  isConfigured: boolean;
  /** The raw stored value, for a settings form that needs to distinguish unset from invalid. */
  stored: string | null;
}

export function useViewerTimezone(): ViewerTimezone {
  const { userData } = useUserData();
  const stored = typeof userData?.timezone === 'string' ? userData.timezone : null;
  const timezone = safeTimezone(stored);

  return {
    timezone,
    // An invalid stored value counts as unconfigured too — the user is being
    // shown UTC either way, and "you have no timezone set" is the actionable
    // thing to say about both.
    isConfigured: !!stored && timezone === stored,
    stored,
  };
}
