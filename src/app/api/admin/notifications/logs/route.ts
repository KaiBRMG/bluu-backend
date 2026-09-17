import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { checkPageAccess, handleApiError, serializeTimestamp } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { NotificationType } from '@/types/firestore';

/**
 * One row of the Logs tab: a single `notifications` document — i.e. one
 * notification as delivered to one user. A manual broadcast to 40 people is 40
 * rows, which is the point: this surface answers "what was sent, and to whom",
 * which the batch-level history tab cannot.
 *
 * Creators are deliberately absent. They have no in-app tray and therefore no
 * `notifications` document at all (telegram.md) — their sends exist only as
 * Telegram messages, so there is nothing here to log. The UI says so rather
 * than implying the list is complete.
 */
export interface NotificationLogRow {
  id: string;
  userId: string;
  /** Empty string signals a deleted user → rendered as italic "Deleted User". */
  displayName: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  dismissedByUser: boolean;
  createdAt: string | null;
  actionUrl: string | null;
  /** Present only on a manual admin broadcast. Absent ⇒ the system sent it. */
  batchId: string | null;
  /** The admin who sent the batch, or null for an automated notification. */
  sentByName: string | null;
}

export interface NotificationLogsResponse {
  rows: NotificationLogRow[];
  /**
   * Document id to pass back as `cursor` for the next page, or null when the
   * window is exhausted. Paging is by document, not by timestamp — two
   * notifications written in the same batch share a `createdAt` to the
   * millisecond, and a timestamp cursor would drop or repeat them.
   */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;

/** Windows the client may ask for, in days. `0` means "everything". */
const ALLOWED_DAYS = new Set([1, 7, 30, 90, 0]);
const DEFAULT_DAYS = 7;

/**
 * GET /api/admin/notifications/logs?days=7&limit=250&cursor=<docId>
 *
 * A page of the delivery log, newest first. Filtering and sorting happen
 * client-side over the fetched page **on purpose**: every server-side facet
 * (type, read, recipient) combined with `orderBy createdAt` needs its own
 * composite index, and the combinations multiply. A bounded window ordered on
 * one field needs none, and the page limit — not the filter — is what caps the
 * read count (cross-cutting rule 9).
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'admin-notifications');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);

    const daysRaw = Number(searchParams.get('days'));
    const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : DEFAULT_DAYS;

    const limitRaw = Number(searchParams.get('limit'));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const cursor = searchParams.get('cursor');

    // Range + order on the SAME field — a single-field index, which Firestore
    // provides by default. No composite index, no firestore.indexes.json change.
    let query = adminDb
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (days > 0) {
      query = query.where(
        'createdAt',
        '>=',
        Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000),
      );
    }

    if (cursor) {
      const cursorDoc = await adminDb.collection('notifications').doc(cursor).get();
      // A cursor pointing at a since-deleted notification (an unsend) would
      // otherwise restart the list from the top — page as exhausted instead.
      if (!cursorDoc.exists) return NextResponse.json({ rows: [], nextCursor: null });
      query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();

    if (snap.empty) {
      return NextResponse.json({ rows: [], nextCursor: null } satisfies NotificationLogsResponse);
    }

    // ── Resolve the two name lookups in one batched read each, field-masked
    //    so only the one field we render comes back (rule 9).
    const userIds = [...new Set(snap.docs.map(doc => doc.data().userId as string).filter(Boolean))];
    const batchIds = [
      ...new Set(snap.docs.map(doc => doc.data().batchId as string | undefined).filter(Boolean)),
    ] as string[];

    const [userDocs, batchDocs] = await Promise.all([
      userIds.length > 0
        ? adminDb.getAll(
            ...userIds.map(uid => adminDb.collection('users').doc(uid)),
            { fieldMask: ['displayName'] },
          )
        : Promise.resolve([]),
      batchIds.length > 0
        ? adminDb.getAll(
            ...batchIds.map(id => adminDb.collection('admin_notification_batches').doc(id)),
            { fieldMask: ['sentByName'] },
          )
        : Promise.resolve([]),
    ]);

    const displayNames: Record<string, string> = {};
    for (const doc of userDocs) {
      if (doc.exists) displayNames[doc.id] = (doc.data()?.displayName as string) ?? '';
    }

    const senderNames: Record<string, string> = {};
    for (const doc of batchDocs) {
      if (doc.exists) senderNames[doc.id] = (doc.data()?.sentByName as string) ?? '';
    }

    const rows: NotificationLogRow[] = snap.docs.map(doc => {
      const data = doc.data();
      const batchId = (data.batchId as string | undefined) ?? null;
      return {
        id: doc.id,
        userId: (data.userId as string) ?? '',
        displayName: displayNames[data.userId] ?? '',
        title: (data.title as string) ?? '',
        message: (data.message as string) ?? '',
        type: (data.type as NotificationType) ?? 'system',
        read: data.read ?? false,
        dismissedByUser: data.dismissedByUser ?? false,
        createdAt: serializeTimestamp(data.createdAt),
        actionUrl: (data.actionUrl as string | null) ?? null,
        batchId,
        // A batch doc that no longer exists (unsent, or predating the field)
        // leaves this null — the row then reads as automated, which is why the
        // client decides "manual" from `batchId`, not from this name.
        sentByName: batchId ? senderNames[batchId] || null : null,
      };
    });

    return NextResponse.json({
      rows,
      nextCursor: snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null,
    } satisfies NotificationLogsResponse);
  } catch (error: unknown) {
    return handleApiError(error, 'admin/notifications/logs GET');
  }
});
