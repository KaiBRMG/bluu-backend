import { NextResponse } from 'next/server';
import { getUserById } from '@/lib/services/userService';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { WriteBatch } from 'firebase-admin/firestore';
import type { NotificationContent } from '@/lib/notificationContent';

// ─── Permission check ───────────────────────────────────────────────

/**
 * Check if a user has access to a specific page. Returns null if access is
 * granted, or a 403 NextResponse if denied.
 */
export async function checkPageAccess(
  uid: string,
  requiredPageId: string,
): Promise<NextResponse | null> {
  const caller = await getUserById(uid);
  if (!caller?.permittedPageIds?.includes(requiredPageId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  return null;
}

// ─── Error handling ─────────────────────────────────────────────────

/**
 * Standardised error response for API routes. Logs the error and returns
 * a JSON error response.
 */
export function handleApiError(
  error: unknown,
  context: string,
  status = 500,
): NextResponse {
  console.error(`[${context}]`, error);
  const message = status < 500 && error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status });
}

// ─── Timestamp serialization ────────────────────────────────────────

/**
 * Safely convert a Firestore Timestamp (or null) to an ISO string.
 */
export function serializeTimestamp(
  ts: { toDate?: () => Date } | null | undefined,
): string | null {
  return ts?.toDate?.()?.toISOString() ?? null;
}

// ─── Notification helper ────────────────────────────────────────────

/**
 * Add a notification document to an existing Firestore batch.
 * Content must come from notificationContent.ts to keep all copy centralised.
 */
export function addNotificationToBatch(
  batch: WriteBatch,
  userId: string,
  content: NotificationContent,
): void {
  batch.set(adminDb.collection('notifications').doc(), {
    userId,
    ...content,
    read: false,
    dismissedByUser: false,
    createdAt: FieldValue.serverTimestamp(),
    announcement: false,
    announcementExpiry: null,
  });
}
