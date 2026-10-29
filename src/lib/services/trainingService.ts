import 'server-only';
import crypto from 'crypto';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  DATASETS,
  IMAGE_LABEL,
  MAX_ANSWER_LENGTH,
  MAX_OUTPUT_BYTES,
  MAX_PARTICIPANTS_PER_MODULE,
  MAX_TEXT_LENGTH,
  MAX_UPLOAD_ATTEMPTS,
  MAX_WORKING_FILES,
  MAX_WORKING_FILE_BYTES,
  SEQUENCE_ANSWER_GRACE_MS,
  TRAINING_MODULES,
  UPLOAD_GRACE_MS,
  WORKING_GRACE_MS,
  WORK_CONTENT_TYPE,
  getModule,
  type DatasetId,
  type TestDef,
  type TrainingModuleDef,
} from '@/lib/training/modules';
import type {
  AdminAttemptCell,
  AdminModuleDetail,
  AdminModuleRow,
  AdminParticipant,
  AdminSubmissionView,
  AttemptView,
  DatasetsResponse,
  MeResponse,
  ModuleResponse,
  ModuleSummary,
  SequenceResponse,
  SourceView,
  TestResponse,
  TestSummary,
} from '@/lib/training/types';
import { emailHashFor, getCandidateName, getCandidateNames } from '@/lib/services/trainingAuthService';
import { TrainingError } from '@/lib/training/errors';
import { splitEmails } from '@/lib/training/emails';
import { cleanFileName } from '@/lib/training/fileName';
import { SCREEN_CHECK_TTL_MS, RECORDING_STALE_MS } from '@/lib/training/recording';
import { materialsProblems, readDataset, readMaterials, testSources } from '@/lib/training/drive';
import type { MirrorTarget } from '@/lib/training/mirror';
import {
  PARTICIPANTS_COLLECTION,
  candidateContext,
  clockEndMs,
  deriveTestState,
  isRunning,
  mirrorStateOf,
  moduleRef,
  isEmailHash,
  newAttemptId,
  participantRef,
  runFrom,
  readModuleDoc,
  requireModule,
  requireTest,
  type AttemptDoc,
  type ModuleDoc,
  type ParticipantDoc,
  type PendingDoc,
  type SlotDoc,
  type WorkingFileDoc,
} from '@/lib/training/model';
import {
  extFor,
  isDeclaredImage,
  latestSegmentAtMs,
  recordingBase,
  signRead,
  signReadUntil,
  signWrite,
  submissionBase,
} from '@/lib/training/storage';

/**
 * Training modules, tests, the roster, and the per-candidate attempt with
 * everything that touches the clock. State and rules live in `lib/training/model`;
 * the screen recording is `trainingRecordingService`; the Drive side is
 * `lib/training/drive`.
 *
 * Two layers of switch, both the admin's:
 *   - the MODULE is on or off. Off = nobody gets a code, and every running
 *     attempt ends where it stands (uploaded work is kept).
 *   - ONE test in a module is open at a time. Closing a test stops new Starts;
 *     clocks already running finish.
 */

/** How long after the grace a candidate's `finalize` call is still honoured (a retry on a flaky line). */
const FINALIZE_WINDOW_MS = 5 * 60 * 1000;
const SIGNED_WRITE_TTL_MS = 15 * 60 * 1000;
/** The task record is autosaved; this throttles a client that saves faster than a person types. */
const TEXT_MIN_INTERVAL_MS = 1000;

// ─── Summaries ───────────────────────────────────────────────────────────────

function summariseTest(now: number, mod: ModuleDoc, test: TestDef, attempt: AttemptDoc | undefined): TestSummary {
  const state = deriveTestState(now, mod, test, attempt);
  return {
    id: test.id,
    title: test.title,
    durationMs: test.durationMs,
    state,
    ...(state === 'in-progress' && attempt ? { deadlineMs: attempt.deadlineMs } : {}),
  };
}

function summariseModule(
  now: number,
  def: TrainingModuleDef,
  mod: ModuleDoc,
  participant: ParticipantDoc,
): ModuleSummary {
  return {
    id: def.id,
    title: def.title,
    blurb: def.blurb,
    openTestId: mod.isOn ? mod.openTestId : null,
    tests: def.tests.map((t) => summariseTest(now, mod, t, participant.attempts?.[t.id])),
  };
}

// ─── Candidate reads ─────────────────────────────────────────────────────────

/** The participations a candidate may act on right now: not revoked, module on. */
async function activeParticipations(emailHash: string) {
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).where('emailHash', '==', emailHash).get();
  // A document from before modules (keyed by session, no `moduleId`) or for a module that no longer
  // exists is not a participation — and `getAll()` with no refs throws, which would take sign-in down.
  const mine = snap.docs
    .map((d) => d.data() as ParticipantDoc)
    .filter((p) => p.revokedAtMs == null && typeof p.moduleId === 'string' && getModule(p.moduleId));
  if (mine.length === 0) return [];

  const ids = [...new Set(mine.map((p) => p.moduleId))];
  const modSnaps = await adminDb.getAll(...ids.map(moduleRef));
  const mods = new Map(ids.map((id, i) => [id, readModuleDoc(modSnaps[i])]));
  return mine
    .map((participant) => ({ participant, mod: mods.get(participant.moduleId) }))
    .filter((x): x is { participant: ParticipantDoc; mod: ModuleDoc } => !!x.mod?.isOn);
}

/** Whether this address is on any module that is switched on — decides whether a code is sent. */
export async function isApproved(emailHash: string): Promise<boolean> {
  return (await activeParticipations(emailHash)).length > 0;
}

export async function getMe(emailHash: string): Promise<MeResponse> {
  const now = Date.now();
  const [active, name] = await Promise.all([activeParticipations(emailHash), getCandidateName(emailHash)]);
  const modules = active
    .map(({ participant, mod }) => {
      const def = getModule(participant.moduleId);
      return def ? summariseModule(now, def, mod, participant) : null;
    })
    .filter((m): m is ModuleSummary => m !== null);
  return { nowMs: now, email: active[0]?.participant.email ?? '', name, modules };
}

/**
 * One module for one candidate: two document reads (`getAll`), not the all-modules query `getMe`
 * runs. This is what the page polls every 15 s while it waits for a test to open.
 */
export async function getModuleForCandidate(emailHash: string, moduleId: string): Promise<ModuleResponse> {
  const def = requireModule(moduleId);
  const ctx = await loadParticipation(emailHash, moduleId);
  if (!ctx || !ctx.mod.isOn) throw new TrainingError('Not found', 404);
  const now = Date.now();
  return { nowMs: now, name: await getCandidateName(emailHash), module: summariseModule(now, def, ctx.mod, ctx.participant) };
}

async function loadParticipation(emailHash: string, moduleId: string) {
  const [pSnap, mSnap] = await adminDb.getAll(participantRef(moduleId, emailHash), moduleRef(moduleId));
  if (!pSnap.exists) return null;
  const participant = pSnap.data() as ParticipantDoc;
  if (participant.revokedAtMs != null) return null;
  return { participant, mod: readModuleDoc(mSnap) };
}

async function attemptView(attempt: AttemptDoc): Promise<AttemptView> {
  const slots = await Promise.all(
    Object.entries(attempt.slots).map(async ([slotId, s]) => ({
      slotId,
      uploadedAtMs: s.uploadedAtMs,
      bytes: s.bytes,
      url: await signRead(s.path),
    })),
  );
  return {
    attemptId: attempt.attemptId,
    startedAtMs: attempt.startedAtMs,
    deadlineMs: attempt.deadlineMs,
    finishedAtMs: attempt.finishedAtMs,
    recording: !!attempt.recording,
    slots,
    workingFiles: Object.entries(attempt.workingFiles ?? {})
      .map(([id, f]) => ({ id, name: f.name, bytes: f.bytes, uploadedAtMs: f.uploadedAtMs }))
      .sort((a, b) => a.uploadedAtMs - b.uploadedAtMs),
    text: attempt.text ?? '',
    textUpdatedAtMs: attempt.textUpdatedAtMs ?? null,
    datasetChoices: attempt.datasetChoices ?? {},
  };
}

async function sourceViews(moduleId: string, test: TestDef): Promise<SourceView[]> {
  const sources = await testSources(moduleId, test);
  return Promise.all(
    sources.map(async (s) => ({
      id: s.driveId,
      name: s.name,
      ...(s.slotId ? { slotId: s.slotId } : {}),
      ...(s.group ? { group: s.group } : {}),
      width: s.width,
      height: s.height,
      thumbUrl: await signRead(s.thumbPath),
      downloadUrl: await signRead(s.path, { download: s.name }),
    })),
  );
}

/**
 * One test for one candidate. The source images are signed ONLY while the
 * attempt is in progress — the briefing must not be able to leak them, and a
 * finished attempt has no reason to see them again. A T7 test never lists its
 * images at all: they come one at a time from `getSequence`.
 */
export async function getTestForCandidate(
  emailHash: string,
  moduleId: string,
  testId: string,
): Promise<TestResponse> {
  const def = requireModule(moduleId);
  const test = requireTest(moduleId, testId);
  const ctx = await loadParticipation(emailHash, moduleId);
  if (!ctx || !ctx.mod.isOn) throw new TrainingError('Not found', 404);
  const { participant, mod } = ctx;

  const now = Date.now();
  const attempt = participant.attempts?.[testId];
  const summary = summariseTest(now, mod, test, attempt);

  const [sources, attemptOut] = await Promise.all([
    summary.state === 'in-progress' && test.kind !== 'sequence' ? sourceViews(moduleId, test) : undefined,
    attempt ? attemptView(attempt) : undefined,
  ]);
  return {
    nowMs: now,
    module: { id: def.id, title: def.title },
    test: summary,
    ...(sources ? { sources } : {}),
    ...(attemptOut ? { attempt: attemptOut } : {}),
  };
}

/** Looks up a running attempt for a read that is only offered while the clock runs. */
async function runningAttempt(emailHash: string, moduleId: string, testId: string) {
  const test = requireTest(moduleId, testId);
  const ctx = await loadParticipation(emailHash, moduleId);
  if (!ctx || !ctx.mod.isOn) throw new TrainingError('Not found', 404);
  const attempt = ctx.participant.attempts?.[testId];
  const now = Date.now();
  if (!isRunning(attempt, ctx.mod, now)) throw new TrainingError('Time is up', 409);
  return { test, attempt, mod: ctx.mod, now };
}

/** The identity datasets, for the modal. Only while the attempt runs; `identity` limits it to one tab's images. */
export async function getDatasets(
  emailHash: string,
  moduleId: string,
  testId: string,
  only: DatasetId | null,
): Promise<DatasetsResponse> {
  const { test, now } = await runningAttempt(emailHash, moduleId, testId);
  const wanted = test.datasets.filter((id) => !only || id === only);
  const datasets = await Promise.all(
    wanted.map(async (id) => ({
      id,
      label: DATASETS[id].label,
      images: await Promise.all(
        (await readDataset(moduleId, id)).map(async (f) => ({
          id: f.driveId,
          name: f.name,
          thumbUrl: await signRead(f.thumbPath),
          downloadUrl: await signRead(f.path, { download: f.name }),
        })),
      ),
    })),
  );
  return { nowMs: now, datasets };
}

// ─── The attempt ─────────────────────────────────────────────────────────────

/**
 * Starts the clock. Idempotent: a second Start (a double tap, a second tab)
 * returns the attempt already running rather than a fresh deadline. Only one
 * test may run at a time, and only the open test can be started.
 */
export async function startAttempt(emailHash: string, moduleId: string, testId: string): Promise<void> {
  const pRef = participantRef(moduleId, emailHash);

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const { participant, mod, test } = candidateContext(pSnap, mSnap, moduleId, testId);

    const now = Date.now();
    if (participant.attempts?.[testId]) return; // already started — idempotent

    const state = deriveTestState(now, mod, test, undefined);
    if (state !== 'open') throw new TrainingError(state === 'missed' ? 'This test has closed' : 'This test is not open yet', 409);

    for (const [otherId, other] of Object.entries(participant.attempts ?? {})) {
      // Still running, or inside the grace where its last uploads may yet land.
      if (!other.finishedAtMs && now <= clockEndMs(other, mod) + UPLOAD_GRACE_MS) {
        throw new TrainingError(`Finish ${requireTest(moduleId, otherId).title} first`, 409);
      }
    }

    // The screen check is the server's half of "no Start without a working recording".
    const checkedAtMs = participant.screenChecks?.[testId]?.atMs ?? 0;
    if (now - checkedAtMs > SCREEN_CHECK_TTL_MS) {
      throw new TrainingError('Share your screen and run the screen check before you start. If you do not see it, refresh this page.', 409);
    }

    const attempt: AttemptDoc = {
      attemptId: newAttemptId(),
      startedAtMs: now,
      deadlineMs: now + test.durationMs,
      finishedAtMs: null,
      recording: true,
      segmentSeq: 0,
      uploadAttempts: 0,
      pending: {},
      slots: {},
      workingFiles: {},
      text: '',
      textUpdatedAtMs: null,
    };
    tx.update(pRef, { [`attempts.${testId}`]: attempt });
  });
}

export type UploadRequest =
  | { kind: 'final'; slotId: string; contentType: string; size: number }
  | { kind: 'work'; fileName: string; size: number };

/**
 * Signs one upload slot. The URL's lifetime is capped at the attempt's end plus
 * the grace (30 s for a final image, 10 min for a working file that may be
 * 250 MB), so one minted in the last minute cannot be used to upload long after
 * the clock ran out. The path is server-chosen and the content type is pinned
 * into the signature — a working file is ALWAYS `application/octet-stream`,
 * never the client's value, so we never sign `text/html` on our bucket.
 */
export async function requestUpload(
  emailHash: string,
  moduleId: string,
  testId: string,
  input: UploadRequest,
): Promise<{ uploadId: string; uploadUrl: string }> {
  if (!Number.isFinite(input.size) || input.size <= 0) throw new TrainingError('That file is empty', 400);
  let contentType = WORK_CONTENT_TYPE;
  if (input.kind === 'final') {
    contentType = input.contentType;
    if (!extFor(contentType)) throw new TrainingError(`Upload a ${IMAGE_LABEL} image`, 400);
    if (input.size > MAX_OUTPUT_BYTES) throw new TrainingError('That file is too large', 400);
  } else if (input.size > MAX_WORKING_FILE_BYTES) {
    throw new TrainingError('That file is too large (250 MB at most)', 400);
  }

  const pRef = participantRef(moduleId, emailHash);
  const uploadId = crypto.randomBytes(12).toString('hex');
  const base = submissionBase(moduleId, emailHash, testId);
  const path =
    input.kind === 'final'
      ? `${base}/final/${input.slotId}-${uploadId}.${extFor(contentType)}`
      : `${base}/work/${uploadId}`;
  // Storage, not Firestore, so it is started now and runs alongside the
  // transaction's reads. Null when the listing itself failed: a Storage hiccup
  // must not lock an honest candidate out.
  const latestSegment = latestSegmentAtMs(recordingBase(moduleId, emailHash, testId)).catch((error) => {
    console.error('[training] segment listing failed', error);
    return null;
  });

  const clockEnd = await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap, latestSegmentMs] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId)), latestSegment]);
    const { participant, mod, test } = candidateContext(pSnap, mSnap, moduleId, testId);
    if (test.kind === 'sequence') throw new TrainingError('This test has no uploads', 400);
    const slot = input.kind === 'final' ? test.slots.find((s) => s.id === input.slotId) : null;
    if (input.kind === 'final' && !slot) throw new TrainingError('Not found', 404);

    const now = Date.now();
    const attempt = participant.attempts?.[testId];
    if (!isRunning(attempt, mod, now)) throw new TrainingError('Time is up', 409);
    if (slot?.pickIdentity && !attempt.datasetChoices?.[slot.id]) {
      throw new TrainingError('Choose which identity this image uses first', 400);
    }
    if (input.kind === 'work' && Object.keys(attempt.workingFiles ?? {}).length >= MAX_WORKING_FILES) {
      throw new TrainingError(`At most ${MAX_WORKING_FILES} working files`, 429);
    }
    // Measured from the start (or reopen) until the first segment lands, which takes a segment's length.
    const recordedUntil = Math.max(latestSegmentMs ?? 0, attempt.startedAtMs, attempt.reopenedAtMs ?? 0);
    if (attempt.recording && latestSegmentMs !== null && now - recordedUntil > RECORDING_STALE_MS) {
      throw new TrainingError('Your screen is not being recorded right now. Share your screen again to keep uploading.', 409);
    }
    if (attempt.uploadAttempts >= MAX_UPLOAD_ATTEMPTS) {
      throw new TrainingError('Too many uploads. Keep the ones you have.', 429);
    }

    const pending: PendingDoc =
      input.kind === 'final'
        ? { kind: 'final', slotId: input.slotId, path, contentType, issuedAtMs: now }
        : { kind: 'work', fileName: cleanFileName(input.fileName), path, contentType, issuedAtMs: now };
    tx.update(pRef, {
      [`attempts.${testId}.uploadAttempts`]: attempt.uploadAttempts + 1,
      [`attempts.${testId}.pending.${uploadId}`]: pending,
    });
    return clockEndMs(attempt, mod);
  });

  const grace = input.kind === 'work' ? WORKING_GRACE_MS : UPLOAD_GRACE_MS;
  const expires = Math.min(Date.now() + SIGNED_WRITE_TTL_MS, clockEnd + grace);
  return { uploadId, uploadUrl: await signWrite(path, contentType, expires) };
}

/**
 * Accepts an upload the browser says it finished. Nothing is taken on trust:
 * the object must exist at the server-chosen path, be within the size limit,
 * carry the declared type, and have been CREATED by the clock's end plus the
 * grace. A final image must also START with its type's magic bytes. Bytes are
 * never downloaded through a function (rule 9i) — only metadata and a 16-byte
 * range.
 */
export async function finalizeUpload(
  emailHash: string,
  moduleId: string,
  testId: string,
  uploadId: string,
): Promise<{ target: MirrorTarget; replacedDriveFileId: string | undefined }> {
  if (!/^[a-f0-9]{24}$/.test(uploadId)) throw new TrainingError('Invalid upload', 400);

  const pRef = participantRef(moduleId, emailHash);
  const [pSnap, mSnap] = await adminDb.getAll(pRef, moduleRef(moduleId));
  const current = pSnap.data() as ParticipantDoc | undefined;
  if (!current || current.revokedAtMs != null) throw new TrainingError('Not found', 404);
  const mod = readModuleDoc(mSnap);
  const attempt = current.attempts?.[testId];
  const pending = attempt?.pending?.[uploadId];
  if (!attempt || !pending) throw new TrainingError('Invalid upload', 400);

  const isWork = pending.kind === 'work';
  const grace = isWork ? WORKING_GRACE_MS : UPLOAD_GRACE_MS;
  const clockEnd = clockEndMs(attempt, mod);
  const now = Date.now();
  if (now > clockEnd + grace + FINALIZE_WINDOW_MS) throw new TrainingError('Time is up', 409);

  const file = adminStorage.bucket().file(pending.path);
  const drop = async (message: string, status = 400): Promise<never> => {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    await pRef.update({ [`attempts.${testId}.pending.${uploadId}`]: FieldValue.delete() }).catch(() => {});
    throw new TrainingError(message, status);
  };

  // Independent round trips to Storage: the object's metadata and (for an image) its first bytes.
  let meta;
  let isImage = true;
  try {
    [[meta], isImage] = await Promise.all([
      file.getMetadata(),
      isWork ? Promise.resolve(true) : isDeclaredImage(pending.path, pending.contentType),
    ]);
  } catch {
    throw new TrainingError('That upload did not arrive. Try again.', 400);
  }
  const size = Number(meta.size);
  const maxBytes = isWork ? MAX_WORKING_FILE_BYTES : MAX_OUTPUT_BYTES;
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) return drop('That file is too large');
  if (meta.contentType !== pending.contentType) return drop('That file type is not accepted');
  const createdMs = Date.parse(String(meta.timeCreated));
  if (!Number.isFinite(createdMs) || createdMs > clockEnd + grace) {
    return drop('That upload finished after time was up', 409);
  }
  if (!isImage) return drop('That file is not a valid image');

  let landed: { target: MirrorTarget; replaced: SlotDoc | null };
  try {
    landed = await adminDb.runTransaction(async (tx) => {
      const [fp, fm] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
      const participant = fp.data() as ParticipantDoc | undefined;
      const fresh = participant?.attempts?.[testId];
      if (!participant || !fresh?.pending?.[uploadId]) throw new TrainingError('Invalid upload', 400);
      // An upload already travelling when the module was switched off may land inside the grace; nothing later.
      if (Date.now() > clockEndMs(fresh, readModuleDoc(fm)) + grace) throw new TrainingError('Training has been ended', 409);

      const now2 = Date.now();
      if (isWork) {
        if (Object.keys(fresh.workingFiles ?? {}).length >= MAX_WORKING_FILES) {
          throw new TrainingError(`At most ${MAX_WORKING_FILES} working files`, 409);
        }
        const doc: WorkingFileDoc = {
          name: pending.fileName ?? 'file',
          path: pending.path,
          bytes: size,
          uploadedAtMs: now2,
          driveState: 'pending',
        };
        tx.update(pRef, {
          [`attempts.${testId}.workingFiles.${uploadId}`]: doc,
          [`attempts.${testId}.pending.${uploadId}`]: FieldValue.delete(),
          mirrorPending: true,
        });
        return { target: { kind: 'work', id: uploadId } as MirrorTarget, replaced: null };
      }

      const test = requireTest(moduleId, testId);
      const slot = test.slots.find((s) => s.id === pending.slotId);
      if (!slot) throw new TrainingError('Not found', 404);
      const replaced = fresh.slots[slot.id] ?? null;
      const identity = slot.identity ?? fresh.datasetChoices?.[slot.id];
      const doc: SlotDoc = {
        path: pending.path,
        bytes: size,
        contentType: pending.contentType,
        uploadedAtMs: now2,
        ...(identity ? { identity } : {}),
        driveState: 'pending',
      };
      tx.update(pRef, {
        [`attempts.${testId}.slots.${slot.id}`]: doc,
        [`attempts.${testId}.pending.${uploadId}`]: FieldValue.delete(),
        mirrorPending: true,
      });
      return { target: { kind: 'slot', slotId: slot.id } as MirrorTarget, replaced };
    });
  } catch (error) {
    if (error instanceof TrainingError && error.status === 409) {
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      await pRef.update({ [`attempts.${testId}.pending.${uploadId}`]: FieldValue.delete() }).catch(() => {});
    }
    throw error;
  }

  const old = landed.replaced && landed.replaced.path !== pending.path ? landed.replaced : null;
  if (old) await adminStorage.bucket().file(old.path).delete({ ignoreNotFound: true }).catch(() => {});
  return { target: landed.target, replacedDriveFileId: old?.driveFileId };
}

/** The task record. Autosaved while the candidate types; accepted until the grace after the clock. */
export async function saveText(emailHash: string, moduleId: string, testId: string, text: string): Promise<void> {
  if (text.length > MAX_TEXT_LENGTH) throw new TrainingError('That is too long', 400);
  const test = requireTest(moduleId, testId);
  if (test.kind === 'sequence') throw new TrainingError('This test has no task record', 400);
  const ctx = await loadParticipation(emailHash, moduleId);
  if (!ctx || !ctx.mod.isOn) throw new TrainingError('Not found', 404);
  const attempt = ctx.participant.attempts?.[testId];
  const now = Date.now();
  if (!attempt || attempt.finishedAtMs || now > clockEndMs(attempt, ctx.mod) + UPLOAD_GRACE_MS) {
    throw new TrainingError('Time is up', 409);
  }
  if (attempt.text === text) return;
  if (attempt.textUpdatedAtMs && now - attempt.textUpdatedAtMs < TEXT_MIN_INTERVAL_MS) {
    throw new TrainingError('Slow down', 429);
  }
  await participantRef(moduleId, emailHash).update({
    [`attempts.${testId}.text`]: text,
    [`attempts.${testId}.textUpdatedAtMs`]: now,
    // The sweep finds work for Drive through this one flag; an attempt with no files still has a record.
    mirrorPending: true,
  });
}

/**
 * T4: choose which identity a slot uses. Each identity is used exactly once, so
 * choosing one already on another slot SWAPS the two rather than refusing. A slot
 * that already has an upload is locked — its identity is part of what was
 * submitted — so a swap that would need to move an uploaded slot is refused.
 */
export async function setIdentity(
  emailHash: string,
  moduleId: string,
  testId: string,
  slotId: string,
  identity: DatasetId,
): Promise<Record<string, DatasetId>> {
  const pRef = participantRef(moduleId, emailHash);
  return adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const { participant, mod, test } = candidateContext(pSnap, mSnap, moduleId, testId);
    const slot = test.slots.find((s) => s.id === slotId);
    if (!slot?.pickIdentity || !test.datasets.includes(identity)) throw new TrainingError('Not found', 404);
    const attempt = participant.attempts?.[testId];
    if (!isRunning(attempt, mod, Date.now())) throw new TrainingError('Time is up', 409);

    const choices = { ...(attempt.datasetChoices ?? {}) };
    if (choices[slotId] === identity) return choices;
    if (attempt.slots[slotId]) throw new TrainingError('This image is already uploaded', 409);

    const holder = Object.entries(choices).find(([, v]) => v === identity)?.[0];
    if (holder) {
      if (attempt.slots[holder]) {
        throw new TrainingError(`${DATASETS[identity].label} is already used on ${holder}`, 409);
      }
      if (choices[slotId]) choices[holder] = choices[slotId];
      else delete choices[holder];
    }
    choices[slotId] = identity;
    tx.update(pRef, { [`attempts.${testId}.datasetChoices`]: choices });
    return choices;
  });
}

/**
 * Ends the test early. Irreversible; leaves whatever was uploaded. A T7 sitting
 * runs its full clock, so for it this only succeeds once the clock has ended. It
 * is also what the room calls when time runs out, which is the cue to write the
 * task record to Drive — there is no cron at the deadline.
 */
export async function finishAttempt(emailHash: string, moduleId: string, testId: string): Promise<void> {
  const test = requireTest(moduleId, testId);
  const pRef = participantRef(moduleId, emailHash);
  await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    const participant = pSnap.data() as ParticipantDoc | undefined;
    if (!participant || participant.revokedAtMs != null) throw new TrainingError('Not found', 404);
    const attempt = participant.attempts?.[testId];
    if (!attempt) throw new TrainingError('Not started', 409);
    if (attempt.finishedAtMs) return;
    if (Date.now() > clockEndMs(attempt, readModuleDoc(mSnap))) return; // the clock already ended it
    if (test.kind === 'sequence') throw new TrainingError('This test runs its full time', 409);
    tx.update(pRef, { [`attempts.${testId}.finishedAtMs`]: Date.now() });
  });
}

// ─── T7: the sequence ────────────────────────────────────────────────────────

/**
 * The ONE image that is current right now. Earlier images are no longer signed
 * and later ones never are — nothing is prefetched, so there is no going back or
 * ahead. The order is the Drive file order, the same for every candidate.
 */
export async function getSequence(emailHash: string, moduleId: string, testId: string): Promise<SequenceResponse> {
  const { test, attempt, now } = await runningAttempt(emailHash, moduleId, testId);
  const seq = test.sequence;
  if (!seq) throw new TrainingError('Not found', 404);

  const from = runFrom(attempt);
  const index = Math.floor((now - from) / seq.windowMs);
  if (index < 0 || index >= seq.count) {
    return { nowMs: now, count: seq.count, windowMs: seq.windowMs, index: null, windowStartsAtMs: null, windowEndsAtMs: null, imageUrl: null, answer: '' };
  }
  const windowStartsAtMs = from + index * seq.windowMs;
  const windowEndsAtMs = windowStartsAtMs + seq.windowMs;
  const file = (await readMaterials(moduleId, test.sources[0].id))[index];
  if (!file) throw new TrainingError('This test is not ready', 409);
  return {
    nowMs: now,
    count: seq.count,
    windowMs: seq.windowMs,
    index,
    windowStartsAtMs,
    windowEndsAtMs,
    imageUrl: await signReadUntil(file.path, windowEndsAtMs + SEQUENCE_ANSWER_GRACE_MS),
    answer: attempt.answers?.[String(index)]?.text ?? '',
  };
}

/** An answer for image `index`: accepted only inside that image's window, plus a few seconds for a request in flight. */
export async function saveAnswer(
  emailHash: string,
  moduleId: string,
  testId: string,
  index: number,
  text: string,
): Promise<void> {
  if (text.length > MAX_ANSWER_LENGTH) throw new TrainingError('That is too long', 400);
  const test = requireTest(moduleId, testId);
  const seq = test.sequence;
  if (!seq || !Number.isInteger(index) || index < 0 || index >= seq.count) throw new TrainingError('Not found', 404);

  const ctx = await loadParticipation(emailHash, moduleId);
  if (!ctx || !ctx.mod.isOn) throw new TrainingError('Not found', 404);
  const attempt = ctx.participant.attempts?.[testId];
  if (!attempt) throw new TrainingError('Not started', 409);
  const now = Date.now();
  const from = runFrom(attempt);
  const start = from + index * seq.windowMs;
  if (attempt.finishedAtMs || now < start || now > start + seq.windowMs + SEQUENCE_ANSWER_GRACE_MS || now > clockEndMs(attempt, ctx.mod) + SEQUENCE_ANSWER_GRACE_MS) {
    throw new TrainingError('Time is up for this image', 409);
  }
  await participantRef(moduleId, emailHash).update({
    [`attempts.${testId}.answers.${index}`]: { text, atMs: now },
    mirrorPending: true,
  });
}

// ─── Admin: modules, tests, roster ───────────────────────────────────────────

export async function listModules(): Promise<AdminModuleRow[]> {
  const defs = Object.values(TRAINING_MODULES);
  const snaps = await adminDb.getAll(...defs.map((d) => moduleRef(d.id)));
  return defs.map((d, i) => {
    const mod = readModuleDoc(snaps[i]);
    return {
      id: d.id,
      title: d.title,
      isOn: mod.isOn,
      openTestId: mod.isOn ? mod.openTestId : null,
      participantCount: mod.participantCount ?? 0,
    };
  });
}

function adminCell(now: number, mod: ModuleDoc, test: TestDef, attempt: AttemptDoc | undefined): AdminAttemptCell {
  return {
    state: deriveTestState(now, mod, test, attempt),
    startedAtMs: attempt?.startedAtMs ?? null,
    deadlineMs: attempt ? clockEndMs(attempt, mod) : null,
    finishedAtMs: attempt?.finishedAtMs ?? null,
    reopenedAtMs: attempt?.reopenedAtMs ?? null,
    slotsFilled: attempt ? Object.keys(attempt.slots).length : 0,
    slotsTotal: test.slots.length,
    mirror: mirrorStateOf(attempt),
  };
}

export async function getModuleDetail(moduleId: string): Promise<AdminModuleDetail> {
  const def = requireModule(moduleId);
  const [mSnap, pSnap] = await Promise.all([
    moduleRef(moduleId).get(),
    adminDb.collection(PARTICIPANTS_COLLECTION).where('moduleId', '==', moduleId).limit(500).get(),
  ]);
  const mod = readModuleDoc(mSnap);
  const docs = pSnap.docs.map((d) => d.data() as ParticipantDoc);
  const names = await getCandidateNames(docs.map((p) => p.emailHash));
  const now = Date.now();

  const participants: AdminParticipant[] = docs
    .map((p) => ({
      emailHash: p.emailHash,
      email: p.email,
      name: names.get(p.emailHash) ?? null,
      addedAtMs: p.addedAtMs,
      revokedAtMs: p.revokedAtMs,
      tests: Object.fromEntries(
        def.tests.map((t) => [t.id, adminCell(now, mod, t, p.attempts?.[t.id])]),
      ) as AdminParticipant['tests'],
    }))
    .sort((a, b) => a.addedAtMs - b.addedAtMs);

  return {
    nowMs: now,
    module: { id: def.id, title: def.title, isOn: mod.isOn, openTestId: mod.isOn ? mod.openTestId : null },
    tests: def.tests.map((t) => {
      const s = mod.tests[t.id];
      return {
        id: t.id,
        title: t.title,
        durationMs: t.durationMs,
        slotCount: t.slots.length,
        status: s?.status ?? 'closed',
        openedAtMs: s?.openedAtMs ?? null,
        closedAtMs: s?.closedAtMs ?? null,
        pending: t.pending ?? [],
      };
    }),
    participants,
  };
}

/**
 * The switch. ON lets approved candidates in. OFF is a hard stop: it closes the
 * open test, and every running attempt ends where it stands (`clockEndMs`) —
 * uploaded work is kept, and uploads already travelling get the grace.
 */
export async function setModuleOn(moduleId: string, on: boolean): Promise<void> {
  requireModule(moduleId);
  const ref = moduleRef(moduleId);
  await adminDb.runTransaction(async (tx) => {
    const mod = readModuleDoc(await tx.get(ref));
    const now = Date.now();
    if (on) {
      if (mod.isOn) return;
      tx.set(ref, { isOn: true, switchedOnAtMs: now }, { merge: true });
      return;
    }
    if (!mod.isOn) return;
    const tests: Record<string, unknown> = {};
    for (const [id, t] of Object.entries(mod.tests)) {
      if (t && t.status !== 'closed') {
        tests[id] = { status: 'closed', closedAtMs: t.status === 'open' ? now : t.closedAtMs };
      }
    }
    tx.set(ref, { isOn: false, switchedOffAtMs: now, openTestId: null, tests }, { merge: true });
  });
}

/**
 * Marks a test `preparing` while its files are copied from Drive. Refused while
 * another test is open (only one at a time) or this one already is.
 */
export async function beginPrepare(moduleId: string, rawTestId: string): Promise<void> {
  const test = requireTest(moduleId, rawTestId);
  const testId = test.id;
  if (test.pending?.length) throw new TrainingError(`${test.id} cannot be opened yet: ${test.pending[0]}`, 409);
  const ref = moduleRef(moduleId);
  await adminDb.runTransaction(async (tx) => {
    const mod = readModuleDoc(await tx.get(ref));
    if (mod.openTestId && mod.openTestId !== testId) throw new TrainingError(`Close ${mod.openTestId} first`, 409);
    if (mod.tests[testId]?.status === 'open') throw new TrainingError(`${testId} is already open`, 409);
    tx.set(ref, { tests: { [testId]: { status: 'preparing' } } }, { merge: true });
  });
}

/**
 * Opens a test for candidates. ENFORCED HERE, not in the page: the module must
 * be on, nothing else may be open, and every Drive manifest the test needs must
 * be complete and cover what it asks for.
 */
export async function openTest(moduleId: string, rawTestId: string): Promise<void> {
  const testId = requireTest(moduleId, rawTestId).id;
  const problems = await materialsProblems(moduleId, testId);
  if (problems.length) throw new TrainingError(problems[0], 409);

  const ref = moduleRef(moduleId);
  await adminDb.runTransaction(async (tx) => {
    const mod = readModuleDoc(await tx.get(ref));
    if (!mod.isOn) throw new TrainingError('Switch the module on first', 409);
    if (mod.openTestId && mod.openTestId !== testId) throw new TrainingError(`Close ${mod.openTestId} first`, 409);
    const now = Date.now();
    tx.set(
      ref,
      {
        openTestId: testId,
        tests: {
          [testId]: {
            status: 'open',
            openedAtMs: now,
            closedAtMs: null,
            materialsVersion: (mod.tests[testId]?.materialsVersion ?? 0) + 1,
          },
        },
      },
      { merge: true },
    );
  });
}

/** No new Starts. Clocks already running finish. */
export async function closeTest(moduleId: string, rawTestId: string): Promise<void> {
  const testId = requireTest(moduleId, rawTestId).id;
  const ref = moduleRef(moduleId);
  await adminDb.runTransaction(async (tx) => {
    const mod = readModuleDoc(await tx.get(ref));
    const status = mod.tests[testId]?.status ?? 'closed';
    if (status === 'closed') return;
    tx.set(
      ref,
      {
        ...(mod.openTestId === testId ? { openTestId: null } : {}),
        tests: { [testId]: { status: 'closed', ...(status === 'open' ? { closedAtMs: Date.now() } : {}) } },
      },
      { merge: true },
    );
  });
}

/** Splits a pasted blob into distinct, normalised addresses. Reports the ones it cannot read. */
function parseEmails(raw: string) {
  const split = splitEmails(raw);
  const seen = new Set<string>();
  const valid: { email: string; emailKey: string; emailHash: string }[] = [];
  const invalid = [...split.invalid];
  for (const token of split.valid) {
    const hashed = emailHashFor(token);
    if (!hashed) invalid.push(token);
    else if (!seen.has(hashed.emailKey)) {
      seen.add(hashed.emailKey);
      valid.push({ email: token, ...hashed });
    }
  }
  return { valid, invalid };
}

/**
 * `invitees` are the addresses that are NEW to the module and should be emailed their
 * invitation now (the caller sends it). A restored person already had one, and while
 * the module is off nobody can sign in, so an invitation then would lead nowhere —
 * those new people are counted in `held` instead.
 */
export async function addParticipants(
  moduleId: string,
  raw: string,
): Promise<{ added: number; invitees: string[]; held: number }> {
  requireModule(moduleId);
  const { valid, invalid } = parseEmails(raw);
  if (invalid.length) throw new TrainingError(`These are not valid emails: ${invalid.slice(0, 5).join(', ')}`, 400);
  if (valid.length === 0) throw new TrainingError('Add at least one email', 400);

  const mRef = moduleRef(moduleId);
  return adminDb.runTransaction(async (tx) => {
    const mod = readModuleDoc(await tx.get(mRef));
    const refs = valid.map((v) => participantRef(moduleId, v.emailHash));
    const snaps = await tx.getAll(...refs);

    let added = 0;
    const fresh: string[] = [];
    const now = Date.now();
    snaps.forEach((snap, i) => {
      if (snap.exists) {
        // Re-adding a removed person restores them with their attempts intact.
        if ((snap.data() as ParticipantDoc).revokedAtMs != null) {
          tx.update(refs[i], { revokedAtMs: null });
          added++;
        }
        return;
      }
      tx.set(refs[i], {
        moduleId,
        emailHash: valid[i].emailHash,
        email: valid[i].email,
        addedAtMs: now,
        revokedAtMs: null,
        attempts: {},
      } satisfies ParticipantDoc);
      fresh.push(valid[i].email);
      added++;
    });

    const count = (mod.participantCount ?? 0) + added;
    if (count > MAX_PARTICIPANTS_PER_MODULE) {
      throw new TrainingError(`At most ${MAX_PARTICIPANTS_PER_MODULE} people per module`, 400);
    }
    tx.set(mRef, { participantCount: count }, { merge: true });
    return { added, invitees: mod.isOn ? fresh : [], held: mod.isOn ? 0 : fresh.length };
  });
}

/** Removes access. The record and any submitted work stay, so the admin can still review them. */
export async function revokeParticipant(moduleId: string, emailHash: string): Promise<void> {
  requireModule(moduleId);
  const pRef = participantRef(moduleId, emailHash);
  const mRef = moduleRef(moduleId);
  await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(mRef)]);
    if (!pSnap.exists) throw new TrainingError('Not found', 404);
    if ((pSnap.data() as ParticipantDoc).revokedAtMs != null) return;
    tx.update(pRef, { revokedAtMs: Date.now() });
    tx.set(mRef, { participantCount: Math.max(0, (readModuleDoc(mSnap).participantCount ?? 1) - 1) }, { merge: true });
  });
}

/**
 * Reopens one candidate's test: the SAME attempt, with its uploads, on a fresh
 * full clock — the escape hatch for a crashed machine. Needs the module on.
 * Refused while a test of theirs is genuinely running (only one runs at a time).
 */
export async function reopenParticipant(moduleId: string, emailHash: string, testId: string): Promise<void> {
  const test = requireTest(moduleId, testId);
  const pRef = participantRef(moduleId, emailHash);

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, mSnap] = await Promise.all([tx.get(pRef), tx.get(moduleRef(moduleId))]);
    if (!pSnap.exists) throw new TrainingError('Not found', 404);
    const participant = pSnap.data() as ParticipantDoc;
    const mod = readModuleDoc(mSnap);
    if (participant.revokedAtMs != null) throw new TrainingError('Restore them first', 409);
    if (!mod.isOn) throw new TrainingError('Switch the module on first', 409);
    if (!participant.attempts?.[testId]) {
      throw new TrainingError('They never started this test. Open the test and they can start it.', 409);
    }

    const now = Date.now();
    for (const [id, a] of Object.entries(participant.attempts)) {
      if (isRunning(a, mod, now)) {
        throw new TrainingError(
          id === testId ? 'That test is already running for them' : `They are in the middle of ${requireTest(moduleId, id).title}`,
          409,
        );
      }
    }

    tx.update(pRef, {
      reopenedAtMs: now,
      [`attempts.${testId}.deadlineMs`]: now + test.durationMs,
      [`attempts.${testId}.finishedAtMs`]: null,
      [`attempts.${testId}.reopenedAtMs`]: now,
      [`attempts.${testId}.uploadAttempts`]: 0,
      [`attempts.${testId}.pending`]: {},
      // The fresh clock is recorded like any other. `segmentSeq` is left alone,
      // so the new run's segments continue after the old ones instead of over them.
      [`attempts.${testId}.recording`]: true,
      [`attempts.${testId}.recordingDeletedAtMs`]: FieldValue.delete(),
    });
  });
}

/** One attempt, laid out for the admin: each final beside its source, the working files, the record, T7's answers. */
export async function getSubmission(moduleId: string, emailHash: string, testId: string): Promise<AdminSubmissionView> {
  if (!isEmailHash(emailHash)) throw new TrainingError('Not found', 404);
  const test = requireTest(moduleId, testId);
  // The sources depend on the test, not on the attempt, so they are read alongside it.
  const [pSnap, sources] = await Promise.all([
    participantRef(moduleId, emailHash).get(),
    test.kind === 'edit' ? testSources(moduleId, test) : Promise.resolve([]),
  ]);
  if (!pSnap.exists) throw new TrainingError('Not found', 404);
  const attempt = (pSnap.data() as ParticipantDoc).attempts?.[testId];

  const sourceBySlot = new Map(sources.filter((s) => s.slotId).map((s) => [s.slotId!, s]));

  const slots = await Promise.all(
    test.slots
      .filter((def) => attempt?.slots[def.id])
      .map(async (def) => {
        const s = attempt!.slots[def.id];
        const src = sourceBySlot.get(def.id);
        return {
          slotId: def.id,
          label: def.label,
          stem: def.stem,
          identity: s.identity ?? null,
          uploadedAtMs: s.uploadedAtMs,
          bytes: s.bytes,
          url: await signRead(s.path),
          mirror: s.driveState ?? 'pending',
          source: src ? { name: src.name, thumbUrl: await signRead(src.thumbPath) } : null,
        };
      }),
  );

  const workingFiles = await Promise.all(
    Object.entries(attempt?.workingFiles ?? {})
      .sort(([, a], [, b]) => a.uploadedAtMs - b.uploadedAtMs)
      .map(async ([id, f]) => ({
        id,
        name: f.name,
        bytes: f.bytes,
        uploadedAtMs: f.uploadedAtMs,
        downloadUrl: await signRead(f.path, { download: f.name }),
        mirror: f.driveState ?? 'pending',
      })),
  );

  let answers: AdminSubmissionView['answers'] = null;
  if (test.sequence) {
    const files = await readMaterials(moduleId, test.sources[0].id);
    answers = await Promise.all(
      Array.from({ length: test.sequence.count }, async (_, index) => {
        const a = attempt?.answers?.[String(index)];
        return {
          index,
          imageUrl: files[index] ? await signRead(files[index].thumbPath) : '',
          text: a?.text ?? null,
          atMs: a?.atMs ?? null,
        };
      }),
    );
  }

  return {
    startedAtMs: attempt?.startedAtMs ?? null,
    finishedAtMs: attempt?.finishedAtMs ?? null,
    slots,
    workingFiles,
    text: attempt?.text ?? '',
    answers,
    driveUrl: attempt?.driveFolderUrl ?? null,
  };
}
