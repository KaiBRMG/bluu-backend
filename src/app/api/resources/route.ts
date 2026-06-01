import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getActiveDocuments } from '@/lib/services/notionService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (_req, token: DecodedIdToken) => {
  try {
    const docs = await getActiveDocuments();

    const caller = await getUserById(token.uid);
    const userGroups = new Set<string>(caller?.groups ?? []);

    // Admins see every document regardless of its Groups column.
    // Check both the JWT claim and explicit 'admin' group membership so the
    // bypass remains correct if the claim ever drifts from the group doc.
    if (token.admin === true || userGroups.has('admin')) {
      return NextResponse.json({ documents: docs });
    }

    const visible = docs.filter(d => d.groups.some(g => userGroups.has(g)));
    return NextResponse.json({ documents: visible });
  } catch (err) {
    console.error('[resources GET]', err);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
});
