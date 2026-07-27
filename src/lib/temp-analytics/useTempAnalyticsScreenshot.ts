'use client';

// ─────────────────────────────────────────────────────────────────────────────
// TEMP ANALYTICS — once-off screenshot collection.
//
// This is throwaway analytical instrumentation. It captures the user's screen
// (via the Electron native capturer already used for time-tracking screenshots)
// when an instrumented page opens. Each trigger waits 3s so the UI has settled
// before the capture.
//
// Collection is gated PER PAGE, PER USER: once a page's screenshots have been
// collected for a user, a localStorage marker prevents any further captures for
// that page + user — permanently. Every capture's storage filename is prefixed
// with the page key so screenshots are attributable per page.
//
// Instrumented pages (pageKey):
//   - Home ("home")  src/app/(main)/page.tsx
//     Allowlisted to TEMP_ANALYTICS_HOME_UIDS — NOT collected from everyone.
//
// The CA-portal pages (disputes / custom-requests / campaigns) were previously
// instrumented and have been decommissioned; their call sites are removed and
// they no longer capture anything. Screenshots already collected from them
// remain in Storage under `temp-analytics/{uid}/`.
//
// TO REMOVE AFTER DATA COLLECTION:
//   1. Delete this file (src/lib/temp-analytics/).
//   2. Delete the route (src/app/api/temp-analytics/).
//   3. Remove the call site in src/app/(main)/page.tsx (search "TEMP ANALYTICS").
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';

const CAPTURE_DELAY_MS = 3000;
const doneKey = (pageKey: string, uid: string) => `temp-analytics-${pageKey}-done-${uid}`;

/**
 * Home-page capture allowlist — Olu (`a5eo2AFDrfdEdRs5W9cUKSnjbem2`).
 *
 * Module-level so its identity is stable across renders. Unlike the CA-portal
 * pages, the home page is instrumented for specific users only; everyone else
 * who opens it is skipped before any capture is attempted.
 */
export const TEMP_ANALYTICS_HOME_UIDS = ['a5eo2AFDrfdEdRs5W9cUKSnjbem2'] as const;

interface TempAnalyticsOptions {
  /**
   * Restrict collection to these uids. Omit to collect from every user who
   * opens the page (the behaviour the CA-portal pages rely on).
   */
  onlyUids?: readonly string[];
}

/**
 * Instruments a page for once-off screenshot collection.
 *
 * @param pageKey Stable slug identifying the page (e.g. "disputes"). Scopes the
 *   per-user "done" marker and prefixes every capture's storage label.
 * @param options `onlyUids` restricts collection to an allowlist.
 * @returns a `capture(label)` function for tab/selection-change events. The
 *   page-open capture fires automatically once the authenticated user resolves.
 */
export function useTempAnalyticsScreenshot(pageKey: string, options?: TempAnalyticsOptions) {
  const { user } = useAuth();
  // Per-mount collection gate. null = undecided, true = collect, false = skip.
  const activeRef = useRef<boolean | null>(null);
  const uidRef = useRef<string | null>(null);
  const pageOpenFiredRef = useRef(false);
  // Collapsed to a string so a fresh options object each render cannot re-run
  // the effect below. Firebase uids are alphanumeric, so ',' is a safe joiner.
  const onlyUidsKey = options?.onlyUids?.join(',') ?? '';

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
      // An allowlist, when present, is checked before the per-user marker so a
      // non-listed user never touches storage or the capturer at all.
      const allowlisted = onlyUidsKey === '' || onlyUidsKey.split(',').includes(uid);
      if (!allowlisted) {
        activeRef.current = false;
      } else {
        try {
          activeRef.current = localStorage.getItem(doneKey(pageKey, uid)) !== '1';
        } catch {
          activeRef.current = false;
        }
      }
    }

    if (!pageOpenFiredRef.current) {
      pageOpenFiredRef.current = true;
      capture('page-open');
    }
  }, [user?.uid, pageKey, capture, onlyUidsKey]);

  return capture;
}
