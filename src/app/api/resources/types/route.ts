import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getResourceTypes } from '@/lib/services/resourceService';

export const GET = withAuth(async () => {
  try {
    const types = await getResourceTypes();
    return NextResponse.json({ types });
  } catch (err) {
    console.error('[resources/types GET]', err);
    return NextResponse.json({ error: 'Failed to fetch types' }, { status: 500 });
  }
});
