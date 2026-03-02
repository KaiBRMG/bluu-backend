import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { ActiveSessionDocument } from '@/types/firestore';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const sessionRef = adminDb.collection('active_sessions').doc(token.uid);

    // Use a Firestore transaction so concurrent requests cannot create two active sessions
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);

      if (snap.exists) {
        const data = snap.data() as ActiveSessionDocument;
        if (!data.userClockOut) {
          // Active session already exists — return it so the client can resume or discard
          return { existing: data };
        }
      }

      // No active session (or previous session was clocked out) — create atomically
      const sessionId = randomUUID();
      const startTime = Date.now();
      tx.set(sessionRef, {
        sessionId,
        userId: token.uid,
        startTime: Timestamp.fromMillis(startTime),
        lastUpdated: FieldValue.serverTimestamp(),
        currentState: 'working',
        userClockOut: false,
      });
      return { sessionId, startTime };
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

    return NextResponse.json({ sessionId: result.sessionId, startTime: result.startTime });
  } catch (error: unknown) {
    console.error('Error starting time tracking:', error);
    return NextResponse.json({ error: 'Failed to start tracking' }, { status: 500 });
  }
});
