import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { isSubmissionStatus } from '@/lib/modelSubmissions';
import {
  SUBMISSIONS_COLLECTION,
  getSubmission,
  signPhotos,
} from '@/lib/services/modelSubmissionService';
import type { ModelSubmissionDetail } from '@/types/modelSubmission';


const PAGE_ID = 'apps-model-submissions';

async function reviewerName(uid: string | null): Promise<string | null> {
  if (!uid) return null;
  const snap = await adminDb.collection('users').doc(uid).get();
  return snap.exists ? snap.data()?.displayName ?? 'Unknown' : 'Unknown';
}

/** Full record + short-lived signed URLs for every photo. */
export const GET = withAuth<{ id: string }>(async (_request, token: DecodedIdToken, params) => {
  const denied = await checkPageAccess(token.uid, PAGE_ID);
  if (denied) return denied;

  try {
    const { id } = await params;
    const doc = await getSubmission(id);
    if (!doc) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

    const [selfies, bodyPhotos, earnings, name] = await Promise.all([
      signPhotos(doc.selfies),
      signPhotos(doc.bodyPhotos),
      signPhotos(doc.earningsPhoto ? [doc.earningsPhoto] : []),
      reviewerName(doc.reviewedBy),
    ]);

    const detail: ModelSubmissionDetail = {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      instagram: doc.instagram,
      telegram: doc.telegram,
      hasOnlyFans: doc.hasOnlyFans,
      age: doc.age,
      country: doc.country,
      city: doc.city,
      sexuality: doc.sexuality,
      niche: doc.niche,
      trialLink: doc.trialLink,
      socialLinks: doc.socialLinks,
      status: doc.status,
      createdAt: doc.createdAt,
      earningsPhoto: earnings[0] ?? null,
      selfies,
      bodyPhotos,
      reviewedByName: name,
      reviewedAt: doc.reviewedAt,
      reviewNote: doc.reviewNote,
    };

    return NextResponse.json({ submission: detail });
  } catch (error) {
    return handleApiError(error, 'model-submissions/admin/[id] GET');
  }
});

/** Approve / reject / reopen. Status is the only client-writable field here. */
export const PATCH = withAuth<{ id: string }>(async (request: NextRequest, token: DecodedIdToken, params) => {
  const denied = await checkPageAccess(token.uid, PAGE_ID);
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body?.status;

    if (!isSubmissionStatus(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const note = typeof body?.reviewNote === 'string' ? body.reviewNote.slice(0, 1000) : '';
    const ref = adminDb.collection(SUBMISSIONS_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

    await ref.update({
      status,
      // Reopening to "new" clears the review trail so the card reads as untouched.
      reviewedBy: status === 'new' ? null : token.uid,
      reviewedAt: status === 'new' ? null : FieldValue.serverTimestamp(),
      reviewNote: status === 'new' ? '' : note,
    });

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return handleApiError(error, 'model-submissions/admin/[id] PATCH');
  }
});
