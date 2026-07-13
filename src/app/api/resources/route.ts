import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getAllResources } from '@/lib/services/resourceService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (_req, token: DecodedIdToken) => {
  try {
    const all = await getAllResources();
    // Only Active resources are surfaced to end users.
    const docs = all.filter(d => d.status === 'Active');

    const caller = await getUserById(token.uid);
    const userGroups = new Set<string>(caller?.groups ?? []);

    // Admins see every active document regardless of Groups/Users.
    // Check both the JWT claim and explicit 'admin' group membership so the
    // bypass remains correct if the claim ever drifts from the group doc.
    if (token.admin === true || userGroups.has('admin')) {
      return NextResponse.json({ documents: docs });
    }

    // Visible if any group overlaps OR the caller is named in the doc's users[].
    const visible = docs.filter(
      d => d.groups.some(g => userGroups.has(g)) || d.users.includes(token.uid)
    );
    return NextResponse.json({ documents: visible });
  } catch (err) {
    console.error('[resources GET]', err);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
});
