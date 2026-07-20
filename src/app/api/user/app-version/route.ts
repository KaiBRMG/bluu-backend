import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/user/app-version
 * Records the caller's installed desktop build on their own user doc so admins
 * can see which version each employee is running (User Management → detail).
 *
 * Machine-reported, so it is deliberately NOT part of the /api/user/update
 * whitelist. The client (AppVersionReporter) only calls this when the reported
 * version differs from the one already on its user snapshot, so this is a
 * write-on-change-only path — no read here, and no write on a normal app start.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json().catch(() => null);
    const rawVersion = body?.appVersion;
    const rawPlatform = body?.platform;

    if (typeof rawVersion !== 'string' || !rawVersion.trim()) {
      return NextResponse.json({ error: 'appVersion is required' }, { status: 400 });
    }
    // Semver-ish only — this string is rendered in the admin UI.
    if (!/^[0-9A-Za-z.\-+]{1,32}$/.test(rawVersion)) {
      return NextResponse.json({ error: 'Invalid appVersion' }, { status: 400 });
    }

    const platform =
      typeof rawPlatform === 'string' && /^[a-z0-9]{1,16}$/.test(rawPlatform) ? rawPlatform : null;

    await adminDb.collection('users').doc(token.uid).update({
      appVersion: rawVersion,
      appPlatform: platform,
      appVersionUpdatedAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(token.uid);
    invalidateAdminUsersCache();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[user/app-version] error:', error);
    return NextResponse.json({ error: 'Failed to record app version' }, { status: 500 });
  }
});
