import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminStorage } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

// ─────────────────────────────────────────────────────────────────────────────
// TEMP ANALYTICS — once-off screenshot collection for the Disputes page.
// Stores captures under Storage folder `temp-analytics/{uid}/`. No Firestore
// docs are written — this is throwaway analytical data only.
//
// TO REMOVE AFTER DATA COLLECTION: delete the src/app/api/temp-analytics/ folder.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BASE64_LENGTH = 10 * 1024 * 1024; // ~10MB per screen

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json();
    const screens: unknown = body.screens;
    const rawLabel: unknown = body.label;

    if (!Array.isArray(screens) || screens.length === 0) {
      return NextResponse.json({ error: 'Missing screens data' }, { status: 400 });
    }
    if (screens.length > 10) {
      return NextResponse.json({ error: 'Too many screens (max 10)' }, { status: 400 });
    }

    // Sanitise label — it becomes part of the storage path.
    const label =
      typeof rawLabel === 'string'
        ? rawLabel.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'unlabeled'
        : 'unlabeled';

    const bucket = adminStorage.bucket();
    const timestamp = Date.now();

    await Promise.all(
      screens.map(async (base64, i) => {
        if (typeof base64 !== 'string' || base64.length === 0 || base64.length > MAX_BASE64_LENGTH) {
          return;
        }
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length === 0) return;

        const path = `temp-analytics/${token.uid}/${timestamp}_${label}_${i}.png`;
        await bucket.file(path).save(buffer, { contentType: 'image/png' });
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error('[temp-analytics] upload failed:', error);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
});
