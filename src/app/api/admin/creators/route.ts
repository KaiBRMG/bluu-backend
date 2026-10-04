import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CreatorSubAccountDocument } from '@/types/firestore';

/** What the Creator Management table renders for each sub-account row. */
interface AdminSubAccountSummary {
  subAccountId: string;
  label: string;
  stageName: string;
  OFID: string;
  isArchived: boolean;
}

const CACHE_TTL_MS = 30_000;
let cache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;

export function invalidateAdminCreatorsCache(): void {
  cache = null;
}

async function fetchCreators() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  // Sub-accounts ride along so the table can list them under their parent
  // without one request per row — one collection read for all of them.
  const [snapshot, subSnap] = await Promise.all([
    adminDb.collection('creators').get(),
    adminDb.collection('creator-subaccounts').get(),
  ]);

  const subAccountsByParent = new Map<string, AdminSubAccountSummary[]>();
  for (const doc of subSnap.docs) {
    const sub = doc.data() as CreatorSubAccountDocument;
    const list = subAccountsByParent.get(sub.parentCreatorId) ?? [];
    list.push({
      subAccountId: doc.id,
      label: sub.label,
      stageName: sub.stageName,
      OFID: sub.OFID ?? '',
      isArchived: sub.isArchived === true,
    });
    subAccountsByParent.set(sub.parentCreatorId, list);
  }
  for (const list of subAccountsByParent.values()) {
    list.sort((a, b) => a.stageName.localeCompare(b.stageName));
  }

  const creators = snapshot.docs.map(doc => {
    // `telegramLinkTokenHash` is pulled out rather than sent: it is only a hash,
    // but it is a pointer to a live invite and the admin table has no use for
    // it. `telegram` is projected down to what the table renders — the raw field
    // carries a Firestore Timestamp, which does not survive JSON as anything
    // usable, and a chat id the client has no business holding.
    const { telegramLinkTokenHash: _hash, telegram, ...data } = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
      telegram: telegram
        ? {
            username: telegram.username ?? null,
            linkedAt: telegram.linkedAt?.toDate?.()?.toISOString() ?? null,
          }
        : null,
      subAccounts: subAccountsByParent.get(doc.id) ?? [],
    };
  });

  cache = { data: creators, expiresAt: Date.now() + CACHE_TTL_MS };
  return creators;
}

async function checkPermission(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('admin-creator-management');
}

/**
 * GET /api/admin/creators
 * Returns all creator documents from the creators collection.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const creators = await fetchCreators();
    return NextResponse.json({ creators });
  } catch (error: unknown) {
    console.error('[GET /api/admin/creators]', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});

/**
 * POST /api/admin/creators
 * Creates a Firebase Auth user and a Firestore creator document.
 *
 * The Auth account carries **no email and no password**. Creators sign in only
 * through Telegram (a custom token minted for this uid — telegram.md), so a
 * credential here would be one nothing can use. It also keeps creator accounts
 * out of the email namespace staff now share, so there is no employee/creator
 * address collision to arbitrate. Older creators still carry the email/password
 * from the password era; those are inert (no `tg` claim — auth.md).
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { stageName, OFID, driveLink = '', defaultTimezone = '' } = body;

    if (!stageName || !OFID) {
      return NextResponse.json({ error: 'stageName and OFID are required' }, { status: 400 });
    }

    const { uid } = await adminAuth.createUser({ displayName: stageName });

    // Write Firestore doc
    await adminDb.collection('creators').doc(uid).set({
      uid,
      creatorID: uid,
      stageName,
      displayName: stageName,
      photoURL: null,
      photoThumb: null,
      photoStoragePath: null,
      OFID,
      isActive: true,
      isArchived: false,
      driveLink: driveLink || '',
      defaultTimezone: defaultTimezone || '',
      lastCRID: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    invalidateAdminCreatorsCache();
    return NextResponse.json({ success: true, uid });
  } catch (error: unknown) {
    console.error('[POST /api/admin/creators]', error);
    return NextResponse.json({ error: 'Failed to create creator' }, { status: 500 });
  }
});
