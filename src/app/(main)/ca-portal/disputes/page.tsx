'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DISPUTES_OPEN_ALL_PARAM } from '@/components/disputes/disputeStatus';

/**
 * `/ca-portal/disputes` — kept as a redirect, not deleted.
 *
 * The page's contents moved onto the dashboard on 2026-09-18: the open review
 * queue became the Sale Disputes column, and the full four-feed workspace
 * became the All-disputes dialog behind it (see `SaleDisputesPanel`).
 *
 * The route survives because five notification `actionUrl`s point at it
 * (`notificationContent.ts`), and a notification is the *slowest* link in the
 * product — one sitting in a tray from last month is still a live link, and
 * the Telegram copy of it is out of our hands entirely. Re-pointing the
 * factories would fix every message sent from here on and break every message
 * already sent. So the address keeps working and forwards to where the content
 * actually lives, with the dialog already open: someone who clicked "your
 * dispute was rejected" arrives looking at their disputes, not at their
 * payslip.
 *
 * `replace`, not `push` — this is an address, not a step, and it must not sit
 * in the history stack waiting to bounce the reader forward again on Back.
 *
 * The matching `ca-disputes` entry is gone from `definitions.ts`, so the
 * sidebar no longer offers it and the permission is no longer granted or
 * checked. **Anyone who held Disputes but not Dashboard needs Dashboard
 * granting** — there is no CA whose work is disputes alone, but that is the
 * one migration this redirect cannot perform for them.
 */

export default function DisputesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/ca-portal/dashboard?${DISPUTES_OPEN_ALL_PARAM}=1`);
  }, [router]);

  // Nothing is rendered on the way through. A skeleton here would be a frame of
  // a page that does not exist, and `NavigationProgress` already covers the gap.
  return null;
}
