import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { buildInterruptedLedgerDoc } from '@/lib/services/activeSessionService';
import { markAnalyticsDirty } from '@/lib/services/analyticsService';
import type { ActiveSessionDocument } from '@/types/firestore';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Optional desktop version/platform reported by the client (feature-detected).
    let appVersion: string | null = null;
    let platform: string | null = null;
    try {
      const body = await request.json();
      if (typeof body?.appVersion === 'string') appVersion = body.appVersion.slice(0, 32);
      if (typeof body?.platform === 'string') platform = body.platform.slice(0, 32);
    } catch {
      // No/invalid body — proceed without version info
    }

    // Stamped on the session so the admin Active Users view can tell "screenshots
    // are off, so no activity % will ever exist" apart from "awaiting first capture".
    // Read before the transaction — getUserById is 60s-cached, so this is usually free.
    const userData = await getUserById(token.uid);
    const enableScreenshots = userData?.enableScreenshots ?? true;
    const timezone = userData?.timezone || 'UTC';

    const sessionRef = adminDb.collection('active_sessions').doc(token.uid);

    // Use a Firestore transaction so concurrent requests cannot create two active sessions
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);

      let displaced: ActiveSessionDocument | null = null;
      let displacedNeedsLedger = false;

      if (snap.exists) {
        const data = snap.data() as ActiveSessionDocument;
        if (!data.userClockOut) {
          // Active session already exists — return it so the client can resume or discard
          return { existing: data };
        }
        // A soft-clocked-out session (app closed without pressing Clock Out).
        // Its event log lives ONLY in the IndexedDB of the device that recorded
        // it, so overwriting this doc is what strands it: that device's later
        // /upload-log would find neither an active session nor a ledger doc and
        // throw the whole shift away. This is the exact clock-in-on-a-second-
        // device path. Reserve it in the ledger first so the log can still land.
        if (data.sessionId) {
          displaced = data;
          // Never clobber a real entry — the session may already have been
          // committed or closed by the cleanup Cloud Function.
          const ledgerSnap = await tx.get(adminDb.collection('time_entries').doc(data.sessionId));
          displacedNeedsLedger = !ledgerSnap.exists;
        }
      }

      // No active session (or previous session was clocked out) — create atomically
      const sessionId = randomUUID();
      const startTime = Date.now();

      if (displaced && displacedNeedsLedger) {
        tx.set(
          adminDb.collection('time_entries').doc(displaced.sessionId),
          buildInterruptedLedgerDoc(displaced, timezone, userData?.enableIdleTimeout ?? true),
        );
      }

      tx.set(sessionRef, {
        sessionId,
        userId: token.uid,
        startTime: Timestamp.fromMillis(startTime),
        lastUpdated: FieldValue.serverTimestamp(),
        currentState: 'working',
        userClockOut: false,
        enableScreenshots,
        appVersion,
        platform,
      });
      return {
        sessionId,
        startTime,
        // Only when we actually wrote a ledger doc — an already-ledgered session
        // is a day that is already accounted for.
        displacedStartMs: displaced && displacedNeedsLedger ? displaced.startTime.toMillis() : null,
      };
    });

    if ('existing' in result) {
      const d = result.existing!;
      return NextResponse.json({
        sessionId: d.sessionId,
        alreadyActive: true,
        currentState: d.currentState,
        startTime: d.startTime.toDate().toISOString(),
        lastUpdated: d.lastUpdated.toDate().toISOString(),
      });
    }

    // A ledger doc now exists for the displaced session's day, so its rollup is
    // stale. (The owning device marks it dirty again when its log merges in.)
    if (result.displacedStartMs !== null) {
      await markAnalyticsDirty(token.uid, result.displacedStartMs, timezone, 'displaced');
    }

    return NextResponse.json({ sessionId: result.sessionId, startTime: result.startTime });
  } catch (error: unknown) {
    console.error('Error starting time tracking:', error);
    return NextResponse.json({ error: 'Failed to start tracking' }, { status: 500 });
  }
});
