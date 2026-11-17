import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminAuth, adminDb, adminStorage } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { invalidateAdminCreatorsCache } from '@/app/api/admin/creators/route';
import { releaseTelegramIndexEntries } from '@/lib/services/telegramLinkService';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  accountIdsForCreatorArchive,
  invalidateOpenArchivedCache,
  removeArchivedAccountsFromSchedule,
} from '@/lib/services/creatorArchiveService';
import { parsePlatformField } from '@/lib/creators/accountPlatform';
import type { DecodedIdToken } from 'firebase-admin/auth';

async function checkPermission(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('admin-creator-management');
}

const ALLOWED_UPDATE_FIELDS = ['stageName', 'OFID', 'platform', 'isActive', 'isArchived', 'driveLink', 'defaultTimezone'] as const;

/**
 * PUT /api/admin/creators/[creatorId]
 * Updates Firestore fields.
 * Syncs disabled state to Firebase Auth on isActive changes.
 */
export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;
    const body = await request.json();

    // The platform decides which OnlyFans data maps to this account, so it is
    // validated rather than copied through like the other fields.
    const parsedPlatform = parsePlatformField(body.platform);
    if (!parsedPlatform.ok) return NextResponse.json({ error: parsedPlatform.error }, { status: 400 });

    // Build whitelisted Firestore update
    const firestoreUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (field in body) {
        firestoreUpdate[field] = body[field];
        // Keep displayName in sync with stageName
        if (field === 'stageName') {
          firestoreUpdate['displayName'] = body[field];
        }
      }
    }

    // Only read the doc when something below needs it: reactivating (the AI
    // creator check) or an archive change (the archive instant).
    const archiving = body.isArchived === true;
    const restoring = body.isArchived === false;
    const snap = body.isActive === true || archiving || restoring
      ? await adminDb.collection('creators').doc(creatorId).get()
      : null;
    if (snap && !snap.exists) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    // The archive instant. Stamped once, on the transition — re-archiving must
    // not move it, because it is the line between sales that are imported and
    // shifts that keep the account, and those that do not. Cleared on restore.
    let archivedAtMs: number | null = null;
    if (archiving) {
      const existing = snap!.get('archivedAt') as Timestamp | undefined;
      if (snap!.get('isArchived') === true && existing) {
        archivedAtMs = existing.toMillis();
      } else {
        archivedAtMs = Date.now();
        firestoreUpdate.archivedAt = Timestamp.fromMillis(archivedAtMs);
      }
    } else if (restoring) {
      firestoreUpdate.archivedAt = null;
    }

    // Build a single Auth update to avoid redundant sequential calls
    const authUpdate: { disabled?: boolean } = {};
    if ('isActive' in body) {
      authUpdate.disabled = !body.isActive;
      // An AI creator's Auth account stays disabled whatever `isActive` says —
      // there is nobody to sign in.
      if (body.isActive === true && snap?.get('isAiCreator') === true) authUpdate.disabled = true;
    }
    if (archiving) authUpdate.disabled = true;

    await Promise.all([
      adminDb.collection('creators').doc(creatorId).update(firestoreUpdate),
      Object.keys(authUpdate).length > 0
        ? adminAuth.updateUser(creatorId, authUpdate)
        : Promise.resolve(),
    ]);
    invalidateAdminCreatorsCache();
    if (archiving || restoring) invalidateOpenArchivedCache();

    // Take the account (and its sub-accounts) off every shift not yet started,
    // and off the overtime board. After the archive itself and non-fatal: the
    // archive has happened either way. The cleanup is safe to re-run; a repeat
    // archive request keeps the original instant.
    if (archivedAtMs !== null) {
      try {
        const schedule = await removeArchivedAccountsFromSchedule({
          accountIds: await accountIdsForCreatorArchive(creatorId),
          cutoffMs: archivedAtMs,
          actorUid: token.uid,
        });
        return NextResponse.json({ success: true, schedule });
      } catch (err) {
        console.error('[PUT /api/admin/creators/[creatorId]] schedule cleanup failed', err);
        return NextResponse.json({ success: true, scheduleError: 'The creator was archived, but could not be removed from upcoming shifts. Remove them in Shift Management.' });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[PUT /api/admin/creators/[creatorId]]', error);
    return NextResponse.json({ error: 'Failed to update creator' }, { status: 500 });
  }
});

/**
 * DELETE /api/admin/creators/[creatorId]
 * Deletes the Firestore doc, Firebase Auth user, and Storage photo.
 */
export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;

    // Read doc first to get storage path
    const docSnap = await adminDb.collection('creators').doc(creatorId).get();
    const photoStoragePath = docSnap.data()?.photoStoragePath ?? null;
    // Read the Telegram ids before the doc goes: `telegram-accounts` is keyed by
    // Telegram id, and a leftover entry would keep resolving a deleted creator's
    // Telegram account to their old uid. Same reason the employee cascade
    // releases the device-session index.
    const telegramUserId: string | undefined = docSnap.get('telegram.userId');
    const telegramTokenHash: string | undefined = docSnap.get('telegramLinkTokenHash');

    // Delete in parallel where possible
    await Promise.all([
      releaseTelegramIndexEntries({
        telegramUserId,
        pendingTokenHash: telegramTokenHash,
      }).catch((err) => {
        console.error(`[DeleteCreator] Failed to release Telegram link for ${creatorId}:`, err);
      }),
      adminDb.collection('creators').doc(creatorId).delete(),
      adminAuth.deleteUser(creatorId),
      photoStoragePath
        ? adminStorage.bucket().file(photoStoragePath).delete().catch(() => null)
        : Promise.resolve(),
    ]);
    invalidateAdminCreatorsCache();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[DELETE /api/admin/creators/[creatorId]]', error);
    return NextResponse.json({ error: 'Failed to delete creator' }, { status: 500 });
  }
});
