import 'server-only';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { UPLOAD_GRACE_MS } from '@/lib/training/modules';
import type { AdminRecordingView, RecordingSlots } from '@/lib/training/types';
import { TrainingError } from '@/lib/training/errors';
import {
  MAX_CHECK_BYTES,
  MAX_SCREEN_CHECKS,
  MAX_SEGMENTS_PER_ATTEMPT,
  SEGMENT_BATCH,
  SEGMENT_URL_TTL_MS,
  parseSegmentName,
  segmentName,
  type RecordingType,
} from '@/lib/training/recording';
import {
  attemptEndMs,
  candidateContext,
  deriveTestState,
  isEmailHash,
  isRunning,
  moduleRef,
  participantRef,
  readModuleDoc,
  requireTest,
  type ParticipantDoc,
  type ScreenCheckDoc,
} from '@/lib/training/model';
import { isDeclaredImage, recordingBase, signRead, signWrite } from '@/lib/training/storage';

/**
 * Screen recording and the screen check — what makes every attempt recorded.
 *
 * The candidate's browser holds a whole-screen share (`getDisplayMedia`) and
 * records it as short, independently playable segments, each PUT straight to
 * Storage over a URL signed here (rule 9i: no video crosses a function). The
 * segments ARE the record: nothing per segment is written to Firestore, and the
 * admin player lists the folder. Two gates make it compulsory:
 *   - Start needs a screen check verified in the last few minutes
 *     (`startAttempt`, in trainingService).
 *   - A final-image upload needs a segment that landed in the last
 *     `RECORDING_STALE_MS` (`requestUpload`).
 *
 * Storage: `training/recordings/{moduleId}/{emailHash}/{testId}/` holds
 * `seg-NNNNNN.webm|mp4` and the screen-check still `check-{id}.jpg`.
 */

const CHECK_ID = /^[a-f0-9]{24}$/;
const CHECK_UPLOAD_TTL_MS = 5 * 60_000;

const checkPath = (moduleId: string, emailHash: string, testId: string, checkId: string) =>
  `${recordingBase(moduleId, emailHash, testId)}/check-${checkId}.jpg`;

/**
 * Signs the upload of one screen-check still: a frame the browser grabbed from
 * the share it will record. Only before the test is started — afterwards the
 * segments themselves are the evidence.
 */
export async function signScreenCheck(
  emailHash: string,
  moduleId: string,
  testId: string,
): Promise<{ checkId: string; uploadUrl: string }> {
  const pRef = participantRef(moduleId, emailHash);
  const checkId = crypto.randomBytes(12).toString('hex');

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const { participant } = candidateContext(pSnap, mSnap, moduleId, testId);
    if (participant.attempts?.[testId]) throw new TrainingError('This test has already started', 409);
    const check = participant.screenChecks?.[testId];
    const count = check?.count ?? 0;
    if (count >= MAX_SCREEN_CHECKS) throw new TrainingError('Too many screen checks. Contact the team.', 429);
    tx.update(pRef, {
      [`screenChecks.${testId}`]: {
        atMs: check?.atMs ?? null,
        path: check?.path ?? null,
        pendingId: checkId,
        count: count + 1,
      } satisfies ScreenCheckDoc,
    });
  });

  const path = checkPath(moduleId, emailHash, testId, checkId);
  return { checkId, uploadUrl: await signWrite(path, 'image/jpeg', Date.now() + CHECK_UPLOAD_TTL_MS) };
}

/** Verifies the still arrived and is a real JPEG, then records the check Start looks for. */
export async function confirmScreenCheck(
  emailHash: string,
  moduleId: string,
  testId: string,
  checkId: string,
): Promise<{ checkedAtMs: number }> {
  if (!CHECK_ID.test(checkId)) throw new TrainingError('Invalid check', 400);
  const path = checkPath(moduleId, emailHash, testId, checkId);
  const file = adminStorage.bucket().file(path);

  let meta;
  let isJpeg: boolean;
  try {
    [[meta], isJpeg] = await Promise.all([file.getMetadata(), isDeclaredImage(path, 'image/jpeg')]);
  } catch {
    throw new TrainingError('The screen check did not reach us. Try again.', 400);
  }
  const size = Number(meta.size);
  const createdMs = Date.parse(String(meta.timeCreated));
  if (!(size > 0 && size <= MAX_CHECK_BYTES) || meta.contentType !== 'image/jpeg' || !isJpeg ||
      !(Date.now() - createdMs < CHECK_UPLOAD_TTL_MS)) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new TrainingError('The screen check was not accepted. Try again.', 400);
  }

  const pRef = participantRef(moduleId, emailHash);
  const now = Date.now();
  const previous = await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const { participant } = candidateContext(pSnap, mSnap, moduleId, testId);
    const check = participant.screenChecks?.[testId];
    if (!check || check.pendingId !== checkId) throw new TrainingError('Invalid check', 400);
    tx.update(pRef, {
      [`screenChecks.${testId}`]: { atMs: now, path, pendingId: null, count: check.count } satisfies ScreenCheckDoc,
    });
    return check.path;
  });
  if (previous && previous !== path) {
    await adminStorage.bucket().file(previous).delete({ ignoreNotFound: true }).catch(() => {});
  }
  return { checkedAtMs: now };
}

/**
 * Signs the next `SEGMENT_BATCH` segment uploads. The sequence numbers are the
 * server's, so a segment can never overwrite another, and every URL dies at the
 * attempt's end plus the grace, like the final-image uploads'.
 */
export async function requestRecordingSlots(
  emailHash: string,
  moduleId: string,
  testId: string,
  contentType: RecordingType,
): Promise<RecordingSlots> {
  const pRef = participantRef(moduleId, emailHash);

  const { first, endsAtMs } = await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const { participant, mod } = candidateContext(pSnap, mSnap, moduleId, testId);
    const attempt = participant.attempts?.[testId];
    const now = Date.now();
    if (!isRunning(attempt, mod, now)) throw new TrainingError('Time is up', 409);
    if (!attempt.recording) throw new TrainingError('This attempt is not recorded', 409);
    const seq = attempt.segmentSeq ?? 0;
    if (seq + SEGMENT_BATCH > MAX_SEGMENTS_PER_ATTEMPT) throw new TrainingError('The recording is full', 429);
    tx.update(pRef, { [`attempts.${testId}.segmentSeq`]: seq + SEGMENT_BATCH });
    return { first: seq, endsAtMs: attemptEndMs(attempt, mod) };
  });

  const base = recordingBase(moduleId, emailHash, testId);
  const expires = Math.min(Date.now() + SEGMENT_URL_TTL_MS, endsAtMs + UPLOAD_GRACE_MS);
  const slots = await Promise.all(
    Array.from({ length: SEGMENT_BATCH }, async (_, i) => ({
      seq: first + i,
      url: await signWrite(`${base}/${segmentName(first + i, contentType)}`, contentType, expires),
    })),
  );
  return { slots };
}

/** One participant's attempt, for the admin recording routes. */
async function loadAdminAttempt(moduleId: string, emailHash: string, testId: string) {
  if (!isEmailHash(emailHash)) throw new TrainingError('Not found', 404);
  const test = requireTest(moduleId, testId);
  const pRef = participantRef(moduleId, emailHash);
  const [pSnap, mSnap] = await Promise.all([pRef.get(), moduleRef(moduleId).get()]);
  if (!pSnap.exists) throw new TrainingError('Not found', 404);
  const participant = pSnap.data() as ParticipantDoc;
  return { pRef, participant, test, attempt: participant.attempts?.[testId], mod: readModuleDoc(mSnap) };
}

/**
 * One attempt's recording for the admin player. `after` returns only the
 * segments past that sequence number — the live view polls with it, so a poll
 * carries the new ten seconds, not the whole sitting (rule 9i). URLs are
 * window-anchored (`signRead`), so a repeated read returns identical strings.
 */
export async function getRecording(
  moduleId: string,
  emailHash: string,
  testId: string,
  after: number | null,
): Promise<AdminRecordingView> {
  const base = recordingBase(moduleId, emailHash, testId);
  // The listing needs only the params, so it runs alongside the two Firestore reads.
  const listing = adminStorage.bucket().getFiles({
    prefix: `${base}/seg-`,
    fields: 'items(name,size,timeCreated),nextPageToken',
    // Lexical, and the names are zero-padded: everything from the next number on.
    ...(after !== null ? { startOffset: `${base}/seg-${String(after + 1).padStart(6, '0')}` } : {}),
  });
  const [{ participant, test, attempt, mod }, [files]] = await Promise.all([
    loadAdminAttempt(moduleId, emailHash, testId),
    listing,
  ]);
  const now = Date.now();
  const live = !!attempt && deriveTestState(now, mod, test, attempt) === 'in-progress';
  const segments = (
    await Promise.all(
      files.map(async (f) => {
        const seq = parseSegmentName(f.name);
        const bytes = Number(f.metadata.size);
        if (seq === null || (after !== null && seq <= after) || !(bytes > 0)) return null;
        return {
          seq,
          endedAtMs: Date.parse(String(f.metadata.timeCreated)) || 0,
          bytes,
          url: await signRead(f.name),
        };
      }),
    )
  )
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.seq - b.seq);

  const check = participant.screenChecks?.[testId];
  return {
    nowMs: now,
    live,
    recorded: !!attempt?.recording,
    startedAtMs: attempt?.startedAtMs ?? null,
    reopenedAtMs: attempt?.reopenedAtMs ?? null,
    endsAtMs: attempt ? attemptEndMs(attempt, mod) : null,
    deletedAtMs: attempt?.recordingDeletedAtMs ?? null,
    ...(after === null
      ? { check: check?.atMs && check.path ? { atMs: check.atMs, url: await signRead(check.path) } : null }
      : {}),
    segments,
  };
}

/**
 * Deletes one attempt's recording and its check still. Refused while the test
 * is running (and through the upload grace): the candidate is still recording,
 * and an empty folder would lock their uploads. The submitted work is untouched.
 */
export async function deleteRecording(moduleId: string, emailHash: string, testId: string): Promise<void> {
  const { pRef, attempt, mod } = await loadAdminAttempt(moduleId, emailHash, testId);
  if (attempt && Date.now() <= attemptEndMs(attempt, mod) + UPLOAD_GRACE_MS) {
    throw new TrainingError('This test is still running. Delete the recording once it has ended.', 409);
  }

  await adminStorage.bucket().deleteFiles({ prefix: `${recordingBase(moduleId, emailHash, testId)}/` });
  await pRef.update({
    ...(attempt ? { [`attempts.${testId}.recordingDeletedAtMs`]: Date.now() } : {}),
    [`screenChecks.${testId}`]: FieldValue.delete(),
  });
}
