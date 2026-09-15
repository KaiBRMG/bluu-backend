'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';

/**
 * "You have no timezone set, so every time here is UTC."
 *
 * Shown app-wide, because the consequence is app-wide: shift times, salary day
 * boundaries, sale timestamps and deadlines all render in the viewer's zone, and
 * a user without one silently reads every one of them in UTC. For anyone in
 * SAST that is two hours out; in the Philippines, eight.
 *
 * **Deliberately not dismissible.** A dismissible banner gets dismissed and the
 * wrong times stay wrong forever, with nothing left on screen to explain them.
 * It is one quiet line and it disappears the moment a timezone is saved, so the
 * only way to be annoyed by it is to have the problem it describes.
 *
 * It renders nothing while `userData` is still loading — flashing a warning at
 * someone who *does* have a timezone, every time they open the app, would be a
 * worse bug than the one it reports.
 */

export function TimezoneNotice() {
  const { isConfigured, stored } = useViewerTimezone();

  // `stored === null` means the user document has not arrived yet. An unset
  // timezone reads as `''`, which is a string — so this distinguishes "still
  // loading" from "genuinely not set" without a separate loading flag.
  if (stored === null || isConfigured) return null;

  const isInvalid = stored !== '';

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2 text-sm"
    >
      <Clock className="size-3.5 shrink-0 text-orange-400" aria-hidden />
      <span className="text-orange-400">
        {isInvalid
          ? `Your timezone (${stored}) isn’t recognised, so times are showing in UTC.`
          : 'You haven’t set a timezone, so all times are showing in UTC.'}
      </span>
      <Link
        href="/applications/settings"
        className="rounded-sm font-medium text-foreground underline underline-offset-2 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        Set it in Settings
      </Link>
    </div>
  );
}
