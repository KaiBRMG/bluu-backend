'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { IconBrandTelegram } from '@tabler/icons-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import {
  announcementConditionMet,
  fetchAnnouncements,
  type ClientAnnouncement,
} from '@/lib/announcementConfig';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The persistent announcement card, top-right under the top bar.
 *
 * **A permanent module, not a Telegram feature.** What it says and who sees it
 * lives entirely in [`announcementConfig.ts`](../../lib/announcementConfig.ts);
 * this component only renders the decision, so the next company-wide thing worth
 * telling people is a config entry rather than another one-off component. It
 * renders nothing at all until an entry is armed.
 *
 * ── The three exits, and why they differ ─────────────────────────────────────
 *
 *  - **Primary action** — does the thing. It does not dismiss: the card retires
 *    itself when the action's *effect* lands (`hideWhen`, re-checked live off the
 *    `useUserData` snapshot), which is the honest signal. A user who opens the
 *    Telegram link and never presses Start has not finished, and the card
 *    correctly stays.
 *  - **"Remind me later"** — hides it for this app session, and re-arms on the
 *    next app start **or the next clock-out**, whichever comes first. Session
 *    state only, deliberately: it must nag. The clock-out trigger is the same
 *    reasoning as `UpdateAvailableBanner` and `EmailMigrationDialog` — a user who
 *    leaves the app running across shifts would otherwise be prompted once, ever.
 *  - **"×"** — permanent, stored on the user doc, so it survives a reinstall and
 *    follows them to another machine. Only offered when the announcement sets
 *    `dismissible`.
 *
 * Unlike the migration dialog this is **not** withheld while clocked in: it is a
 * small card in a corner, not a blocking overlay, and the whole point is that it
 * persists across pages. The clock-out event is a re-arm trigger here, not a
 * precondition.
 *
 * ── Why it re-fetches rather than reading the constant ───────────────────────
 * `fetchAnnouncements` hits `/api/announcements`. A renderer open for a week is
 * running the bundle it launched with, so a compiled-in read could never reach
 * the users an announcement most needs to reach (cross-cutting rule 9c). It
 * fetches on mount and again on each clock-out — twice a shift, not on a timer.
 */
export default function AnnouncementCard() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const { displayState } = useTimeTrackingContext();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<ClientAnnouncement[]>([]);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void fetchAnnouncements().then(setAnnouncements);
  }, []);

  useEffect(() => {
    if (!userData) return;
    load();
  }, [userData, load]);

  // Re-arm on the clock-out *transition*, not on the state — otherwise every
  // render while clocked out would clear a snooze the user just asked for.
  const previousState = useRef(displayState);
  useEffect(() => {
    const wasClockedOut = previousState.current === 'clocked-out';
    previousState.current = displayState;
    if (displayState === 'clocked-out' && !wasClockedOut) {
      setSnoozed([]);
      load();
    }
  }, [displayState, load]);

  const dismissed = userData?.dismissedAnnouncements ?? [];
  const announcement = announcements.find(
    (a) =>
      !snoozed.includes(a.id) &&
      !dismissed.includes(a.id) &&
      // Re-checked here, live: the server's answer is a point-in-time one, and
      // the card should vanish the moment the user finishes the thing it asked
      // for rather than at the next fetch.
      !announcementConditionMet(a, userData),
  );

  const handlePrimary = useCallback(async () => {
    if (!announcement || busy) return;
    const { action } = announcement;

    if (action.kind === 'route') {
      router.push(action.href);
      return;
    }
    if (action.kind === 'external') {
      // `setWindowOpenHandler` in the shell turns this into `shell.openExternal`
      // and denies the popup — nothing under electron/ changes for this to work.
      window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }

    // telegram-link: the URL is minted per click and is single-use, so it is
    // fetched at the moment of the click rather than held in state.
    setBusy(true);
    try {
      if (!user) throw new Error('Your session expired. Please sign in again.');
      const idToken = await user.getIdToken();
      const res = await fetch('/api/user/telegram-link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = (await res.json()) as { url?: string };
      if (!url) throw new Error('No link returned');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      console.error('[AnnouncementCard] telegram link failed:', error);
      toast.error('Could not generate your Telegram link. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [announcement, busy, router, user]);

  const handleDismiss = useCallback(async () => {
    if (!announcement) return;
    // Optimistic: the snapshot will carry the same id back a moment later, and
    // a failed write only means the card returns on the next app start.
    setSnoozed((ids) => [...ids, announcement.id]);
    try {
      if (!user) return;
      const idToken = await user.getIdToken();
      await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ dismissedAnnouncements: [announcement.id] }),
      });
    } catch (error: unknown) {
      console.error('[AnnouncementCard] dismiss failed:', error);
    }
  }, [announcement, user]);

  if (!announcement) return null;

  const isTelegram = announcement.action.kind === 'telegram-link';

  return (
    <div
      className="fixed right-6 top-[4.5rem] z-[var(--z-banner)] w-[22rem] max-w-[calc(100vw-3rem)]"
      role="status"
      aria-live="polite"
    >
      <Card className="gap-3 border-white/[0.07] bg-[#171717] py-4">
        <CardHeader className="px-4">
          <div className="flex items-start gap-3">
            {isTelegram && (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3b82f6]/10 text-[#60a5fa]">
                <IconBrandTelegram size={18} stroke={1.75} />
              </span>
            )}
            <CardTitle className="text-lg leading-snug">{announcement.title}</CardTitle>
            {announcement.dismissible && (
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss this message"
                className="-mr-1 -mt-1 ml-auto shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-4">
          <p className="text-sm leading-relaxed text-zinc-400">{announcement.body}</p>

          <div className="flex items-center justify-end gap-2">
            {announcement.secondaryLabel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSnoozed((ids) => [...ids, announcement.id])}
              >
                {announcement.secondaryLabel}
              </Button>
            )}
            <Button size="sm" onClick={handlePrimary} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {announcement.primaryLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
