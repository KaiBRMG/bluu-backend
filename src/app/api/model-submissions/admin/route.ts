import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { listSubmissions, signThumbs } from '@/lib/services/modelSubmissionService';
import type { ModelSubmissionSummary } from '@/types/modelSubmission';


const PAGE_ID = 'apps-model-submissions';

/**
 * Thumbnails sent per card. Reviewers page through the applicant's photos
 * without leaving the grid, so the whole set travels — they are ~30KB WebP each
 * and the URLs are signed locally (no network round trip per file). The
 * earnings screenshot is deliberately excluded: financial detail belongs behind
 * the click into the record, not on a browsable wall.
 */
const CARD_THUMBS = 12;

/**
 * Reviewer list. Returns summaries only — thumbnails, no full-size URLs and no
 * contact details — so the list view stays cheap and the sensitive fields only
 * travel when a reviewer actually opens a submission.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const denied = await checkPageAccess(token.uid, PAGE_ID);
  if (denied) return denied;

  try {
    const docs = await listSubmissions();

    // Resolve reviewer display names in one batched read rather than per row.
    const reviewerIds = [...new Set(docs.map((d) => d.reviewedBy).filter((v): v is string => !!v))];
    const names = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const snaps = await adminDb.getAll(
        ...reviewerIds.map((uid) => adminDb.collection('users').doc(uid)),
      );
      for (const snap of snaps) {
        if (snap.exists) names.set(snap.id, snap.data()?.displayName ?? 'Unknown');
      }
    }

    const submissions: ModelSubmissionSummary[] = await Promise.all(
      docs.map(async (d) => {
        const photoCount = d.selfies.length + d.bodyPhotos.length + (d.earningsPhoto ? 1 : 0);
        const thumbs = await signThumbs([...d.selfies, ...d.bodyPhotos].slice(0, CARD_THUMBS));
        return {
          id: d.id,
          name: d.name,
          age: d.age,
          country: d.country,
          city: d.city,
          hasOnlyFans: d.hasOnlyFans,
          status: d.status,
          createdAt: d.createdAt,
          photoCount,
          thumbs,
          reviewedByName: d.reviewedBy ? names.get(d.reviewedBy) ?? 'Unknown' : null,
          reviewedAt: d.reviewedAt,
        };
      }),
    );

    return NextResponse.json({ submissions });
  } catch (error) {
    return handleApiError(error, 'model-submissions/admin');
  }
});
