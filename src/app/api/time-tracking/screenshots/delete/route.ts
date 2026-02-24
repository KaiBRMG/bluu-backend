import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { deleteScreenshots } from '@/lib/services/screenshotService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Must be admin
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { screenshotIds } = await request.json();
    if (!Array.isArray(screenshotIds) || screenshotIds.length === 0) {
      return NextResponse.json({ error: 'screenshotIds must be a non-empty array' }, { status: 400 });
    }

    if (screenshotIds.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 screenshots per delete request' }, { status: 400 });
    }

    await deleteScreenshots(screenshotIds);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting screenshots:', error);
    return NextResponse.json({ error: 'Failed to delete screenshots' }, { status: 500 });
  }
});
