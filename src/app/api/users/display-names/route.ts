import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getAllGroups } from '@/lib/services/groupService';

export interface BasicUser {
  uid: string;
  firstName: string;
  lastName: string;
  displayName: string;
  photoURL?: string;
  groups: string[];
  jobTitle?: string;
  workEmail: string;
  isActive: boolean;
}

const CACHE_TTL_MS = 30_000;
let cache: { data: { users: BasicUser[]; groups: Record<string, unknown>[] }; expiresAt: number } | null = null;

export function invalidateDisplayNamesCache(): void {
  cache = null;
}

/**
 * GET /api/users/display-names
 * Returns basic user info (name, photo, groups) for any authenticated employee.
 * Does not expose sensitive fields (pay info, DOB, contact details, etc.).
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    if (cache && Date.now() < cache.expiresAt) {
      return NextResponse.json(cache.data);
    }

    const [snap, groups] = await Promise.all([
      adminDb.collection('users').get(),
      getAllGroups(),
    ]);

    const users: BasicUser[] = snap.docs.map(doc => {
      const d = doc.data();
      return {
        uid: d.uid ?? doc.id,
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        displayName: d.displayName ?? '',
        photoURL: d.photoURL,
        groups: d.groups ?? [],
        jobTitle: d.jobTitle,
        workEmail: d.workEmail ?? '',
        isActive: d.isActive !== false,
      };
    });

    const serializedGroups = groups.map(g => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
        if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
          out[k] = (v as { toDate(): Date }).toDate().toISOString();
        } else {
          out[k] = v;
        }
      }
      return out;
    });

    const data = { users, groups: serializedGroups };
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[users/display-names GET]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
