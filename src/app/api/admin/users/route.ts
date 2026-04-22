import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllGroups } from '@/lib/services/groupService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const CACHE_TTL_MS = 30_000;
let cache: { data: { users: Record<string, unknown>[]; groups: Record<string, unknown>[] }; expiresAt: number } | null = null;

export function invalidateAdminUsersCache(): void {
  cache = null;
}

function serializeTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
      out[k] = (v as { toDate(): Date }).toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function fetchUsersAndGroups() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const [usersSnapshot, groups] = await Promise.all([
    adminDb.collection('users').get(),
    getAllGroups(),
  ]);

  const users = usersSnapshot.docs.map(doc => serializeTimestamps(doc.data()));
  const serializedGroups = groups.map(g => serializeTimestamps(g as Record<string, unknown>));

  const data = { users, groups: serializedGroups };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/**
 * GET /api/admin/users
 * Admin-only. Returns all users with full document data and all groups.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const data = await fetchUsersAndGroups();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
