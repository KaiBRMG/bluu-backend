import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SMM_ACCOUNTS,
  checkSmmAccess,
  resolveUserInfo,
  serializeAccount,
  validateAccountFields,
} from '@/lib/services/smmService';
import { SMM_NETWORKS } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/accounts?scope=mine|active|all[&network=<network>]
 *  - mine:   active accounts assigned to the caller (dashboard kanban + post dropdowns)
 *  - active: all active accounts, slim shape (bonus wizard original-account dropdown)
 *  - all:    every account incl. inactive, with resolved user names (admin database).
 *            The admin database lazy-loads one network group at a time, so scope=all
 *            accepts an optional `network` filter (single-equality, auto-indexed) to
 *            avoid reading the whole collection up front.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'mine';

    if (scope === 'all') {
      const denied = await checkSmmAccess(token.uid, 'admin');
      if (denied) return denied;

      const network = request.nextUrl.searchParams.get('network');
      if (network !== null && !(SMM_NETWORKS as readonly string[]).includes(network)) {
        return NextResponse.json({ error: 'Invalid network' }, { status: 400 });
      }

      const base = adminDb.collection(SMM_ACCOUNTS);
      const snap = await (network ? base.where('network', '==', network) : base).get();
      const accounts = snap.docs.map(serializeAccount);
      const names = await resolveUserInfo(
        accounts.flatMap((a) => [a.assigned ?? '', a.lastUpdatedBy]),
      );
      for (const a of accounts) {
        if (a.assigned) {
          a.assignedName = names.get(a.assigned)?.displayName ?? '';
          a.assignedPhotoURL = names.get(a.assigned)?.photoURL ?? null;
        }
        a.lastUpdatedByName = names.get(a.lastUpdatedBy)?.displayName ?? '';
      }
      accounts.sort((a, b) => a.accountName.localeCompare(b.accountName));
      return NextResponse.json({ accounts });
    }

    const denied = await checkSmmAccess(token.uid, 'either');
    if (denied) return denied;

    if (scope === 'active') {
      const snap = await adminDb.collection(SMM_ACCOUNTS).where('status', '==', 'active').get();
      const accounts = snap.docs
        .map((doc) => ({ id: doc.id, accountName: (doc.data().accountName as string) ?? '' }))
        .sort((a, b) => a.accountName.localeCompare(b.accountName));
      return NextResponse.json({ accounts });
    }

    // scope=mine
    const snap = await adminDb
      .collection(SMM_ACCOUNTS)
      .where('assigned', '==', token.uid)
      .where('status', '==', 'active')
      .get();
    const accounts = snap.docs.map(serializeAccount)
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('[GET /api/smm/accounts]', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
});

/** POST /api/smm/accounts — create an account (admin page only). */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const body = await request.json() as {
      accountName?: string;
      accountLink?: string;
      type?: string[];
      network?: string;
      tier?: number;
      assigned?: string | null;
      driveLink?: string;
      comments?: string;
      information?: string;
      status?: string;
    };

    if (!body.accountName?.trim() || !body.accountLink?.trim()) {
      return NextResponse.json({ error: 'Account name and link are required' }, { status: 400 });
    }
    const invalid = validateAccountFields(body);
    if (invalid) return invalid;

    const ref = adminDb.collection(SMM_ACCOUNTS).doc();
    await ref.set({
      accountName: body.accountName.trim(),
      accountLink: body.accountLink.trim(),
      type: body.type ?? [],
      network: body.network ?? 'Other',
      tier: body.tier ?? 1,
      assigned: body.assigned ?? null,
      driveLink: body.driveLink ?? '',
      comments: body.comments ?? '',
      information: body.information ?? '',
      status: body.status ?? 'active',
      lastUpdatedTime: FieldValue.serverTimestamp(),
      lastUpdatedBy: token.uid,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (error) {
    console.error('[POST /api/smm/accounts]', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
});
