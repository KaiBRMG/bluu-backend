import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { MIN_FILL_SECONDS, fieldErrors, submissionSchema } from '@/lib/modelSubmissions';
import {
  SUBMISSIONS_COLLECTION,
  clientIp,
  consumeRate,
  consumeSession,
  hashIp,
  loadSession,
  resolvePhotos,
} from '@/lib/services/modelSubmissionService';


/**
 * PUBLIC — finalises an application.
 *
 * The client's copy of the schema is convenience only; everything is re-parsed
 * here. Photo ids are resolved against the records this server wrote during
 * upload, so a caller cannot point a submission at storage paths it invented.
 * The session is consumed inside a transaction, which makes double-submission
 * (a retry, a double-tap, a replayed request) impossible.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid submission.' }, { status: 400 });
    }

    const sessionId = String(body.sessionId ?? '');
    const token = String(body.token ?? '');

    // Honeypot: a field no human sees, so anything in it is a bot. Answer 200 so
    // the script believes it succeeded and doesn't retry with the field removed.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return NextResponse.json({ ok: true });
    }
    // Nobody fills four sections of a form, with photos, in eight seconds.
    if (typeof body.elapsedMs === 'number' && body.elapsedMs < MIN_FILL_SECONDS * 1000) {
      return NextResponse.json({ ok: true });
    }

    const session = await loadSession(sessionId, token);
    if (!session) {
      return NextResponse.json(
        { error: 'Your form session expired. Refresh the page and submit again.' },
        { status: 401 },
      );
    }

    const parsed = submissionSchema.safeParse(body.fields);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Some answers need fixing.', fields: fieldErrors(parsed.error) },
        { status: 400 },
      );
    }
    const f = parsed.data;

    const ipHash = hashIp(clientIp(request.headers));
    if (!(await consumeRate(ipHash, 'submissions'))) {
      return NextResponse.json(
        { error: 'Too many applications from this connection. Try again tomorrow.' },
        { status: 429 },
      );
    }

    // Ids → the photo records this server stored. Anything unrecognised is dropped.
    const [selfies, bodyPhotos, earnings] = await Promise.all([
      resolvePhotos(sessionId, f.selfieIds, 'selfie'),
      resolvePhotos(sessionId, f.bodyPhotoIds, 'body'),
      resolvePhotos(sessionId, f.earningsPhotoId ? [f.earningsPhotoId] : [], 'earnings'),
    ]);

    if (selfies.length < f.selfieIds.length || bodyPhotos.length < f.bodyPhotoIds.length) {
      return NextResponse.json(
        { error: 'Some photos did not finish uploading. Please re-add them.' },
        { status: 400 },
      );
    }

    if (!(await consumeSession(sessionId))) {
      return NextResponse.json({ error: 'This application was already submitted.' }, { status: 409 });
    }

    const batch = adminDb.batch();
    batch.set(adminDb.collection(SUBMISSIONS_COLLECTION).doc(sessionId), {
      name: f.name,
      email: f.email.toLowerCase(),
      instagram: f.instagram,
      telegram: f.telegram,
      hasOnlyFans: f.hasOnlyFans,
      age: f.age,
      country: f.country,
      city: f.city,
      sexuality: f.sexuality,
      // Section 3 is only meaningful when the applicant has an account.
      niche: f.hasOnlyFans ? f.niche : '',
      trialLink: f.hasOnlyFans ? f.trialLink : '',
      socialLinks: f.hasOnlyFans ? f.socialLinks : '',
      earningsPhoto: f.hasOnlyFans ? (earnings[0] ?? null) : null,
      selfies,
      bodyPhotos,
      status: 'new',
      createdAt: FieldValue.serverTimestamp(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: '',
      // Retained for abuse investigation only — never a raw IP.
      ipHash,
    });

    // Notify everyone who can act on it (page permission is the audience).
    const reviewers = await adminDb
      .collection('users')
      .where('permittedPageIds', 'array-contains', 'apps-model-submissions')
      .select()
      .get();
    const content = notifications.modelSubmissionReceived(f.name, `${f.city}, ${f.country}`);
    for (const doc of reviewers.docs) {
      addNotificationToBatch(batch, doc.id, content);
    }

    await batch.commit();

    return NextResponse.json({ ok: true, name: f.name });
  } catch (error) {
    console.error('[model-submissions/submit]', error);
    return NextResponse.json({ error: 'Submission failed. Please try again.' }, { status: 500 });
  }
}
