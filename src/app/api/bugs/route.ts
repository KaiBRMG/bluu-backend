import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, stack, context, url, userAgent, uid, displayName, appVersion, platform } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    await adminDb.collection('bugs').add({
      message: message.slice(0, 2000),
      stack: stack ? String(stack).slice(0, 5000) : null,
      context: context ?? 'unknown',
      url: url ?? null,
      userAgent: userAgent ?? null,
      uid: uid ?? null,
      displayName: displayName ?? null,
      appVersion: typeof appVersion === 'string' ? appVersion.slice(0, 32) : null,
      platform: typeof platform === 'string' ? platform.slice(0, 32) : null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Don't let bug reporting itself blow up the app
    console.error('[bugs] Failed to write bug report:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
