'use client';

// ─────────────────────────────────────────────────────────────────────────────
// TEMP ANALYTICS — once-off screenshot collection for select CA-portal pages.
//
// This is throwaway analytical instrumentation. It captures the user's screen
// (via the Electron native capturer already used for time-tracking screenshots)
// when an instrumented page opens and when they change its tab/creator selection.
// Each trigger waits 1s so the UI has settled before the capture.
//
// Collection is gated PER PAGE, PER USER: once a page's screenshots have been
// collected for a user, a localStorage marker prevents any further captures for
// that page + user — permanently. Every capture's storage filename is prefixed
// with the page key so screenshots are attributable per page.
//
// Instrumented pages (pageKey):
//   - Disputes         ("disputes")        src/app/(main)/ca-portal/disputes/page.tsx
//   - Custom Requests  ("custom-requests") src/app/(main)/ca-portal/custom-requests/page.tsx
//   - Campaigns        ("campaigns")       src/app/(main)/ca-portal/campaigns/page.tsx
//
// TO REMOVE AFTER DATA COLLECTION:
//   1. Delete this file (src/lib/temp-analytics/).
//   2. Delete the route (src/app/api/temp-analytics/).
//   3. Remove the call sites in each instrumented page (search "TEMP ANALYTICS").
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';

const CAPTURE_DELAY_MS = 1000;
const doneKey = (pageKey: string, uid: string) => `temp-analytics-${pageKey}-done-${uid}`;

/**
 * Instruments a page for once-off screenshot collection.
 *
 * @param pageKey Stable slug identifying the page (e.g. "disputes"). Scopes the
 *   per-user "done" marker and prefixes every capture's storage label.
 * @returns a `capture(label)` function for tab/selection-change events. The
 *   page-open capture fires automatically once the authenticated user resolves.
 */
export function useTempAnalyticsScreenshot(pageKey: string) {
  const { user } = useAuth();
  // Per-mount collection gate. null = undecided, true = collect, false = skip.
  const activeRef = useRef<boolean | null>(null);
  const uidRef = useRef<string | null>(null);
  const pageOpenFiredRef = useRef(false);

  const capture = useCallback((label: string) => {
    if (activeRef.current !== true) return;
    const uid = uidRef.current;
    if (!uid) return;

    const captureScreenshot =
      typeof window !== 'undefined'
        ? window.electronAPI?.timeTracking?.captureScreenshot
        : undefined;
    if (!captureScreenshot) return;

    setTimeout(async () => {
      if (activeRef.current !== true) return;
      try {
        const result = await captureScreenshot();
        if (!result.success || !result.screens?.length) return;

        const idToken = await user?.getIdToken();
        if (!idToken) return;

        await fetch('/api/temp-analytics/screenshot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ screens: result.screens, label: `${pageKey}-${label}` }),
        });

        // Mark this page collected for this user so future sessions never trigger again.
        try {
          localStorage.setItem(doneKey(pageKey, uid), '1');
        } catch {
          /* ignore storage failures */
        }
      } catch (err) {
        console.error('[temp-analytics] capture failed:', err);
      }
    }, CAPTURE_DELAY_MS);
  }, [user, pageKey]);

  // Decide the gate and fire the page-open capture once the user resolves.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    uidRef.current = uid;

    if (activeRef.current === null) {
      try {
        activeRef.current = localStorage.getItem(doneKey(pageKey, uid)) !== '1';
      } catch {
        activeRef.current = false;
      }
    }

    if (!pageOpenFiredRef.current) {
      pageOpenFiredRef.current = true;
      capture('page-open');
    }
  }, [user?.uid, pageKey, capture]);

  return capture;
}
