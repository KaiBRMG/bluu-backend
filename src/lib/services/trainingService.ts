import 'server-only';
import crypto from 'crypto';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  MAX_OUTPUT_BYTES,
  MAX_PARTICIPANTS_PER_SESSION,
  MAX_SOURCES_PER_PART,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PREVIEW_BYTES,
  MAX_UPLOAD_ATTEMPTS,
  IMAGE_LABEL,
  IMAGE_TYPES,
  type ImageSniff,
  UPLOAD_GRACE_MS,
  getModule,
  getPart,
  type SlotId,
  type TrainingModuleId,
  type TrainingPartDef,
} from '@/lib/training/modules';
import type {
  AdminCandidateDetail,
  AdminRecordingView,
  AdminCandidateRow,
  AdminCandidatePart,
  AdminCandidateSession,
  AdminParticipant,
  AdminSessionDetail,
  AdminSessionProgress,
  AdminSessionRow,
  AdminSubmissionView,
  AttemptView,
  CandidateStatus,
  MeResponse,
  PartResponse,
  PartState,
  PartSummary,
  RecordingSlots,
  SessionSummary,
  SourceView,
} from '@/lib/training/types';
import { emailHashFor, getCandidateName, getCandidateNames } from '@/lib/services/trainingAuthService';
import { TrainingError } from '@/lib/training/errors';
import { splitEmails } from '@/lib/training/emails';
import {
  MAX_CHECK_BYTES,
  MAX_SCREEN_CHECKS,
  MAX_SEGMENTS_PER_ATTEMPT,
  RECORDING_STALE_MS,
  SCREEN_CHECK_TTL_MS,
  SEGMENT_BATCH,
  SEGMENT_URL_TTL_MS,
  parseSegmentName,
  segmentName,
  type RecordingType,
} from '@/lib/training/recording';

/**
 * Training sessions, the per-candidate attempt and everything that touches the
 * clock. Admin-SDK-only collections, no client rule (rule 10):
 *
 *   training-sessions/{id}                 the sitting: module, schedule, source images
 *   training-participants/{id}_{emailHash} one candidate in one sitting + their attempts
 *   training-candidates/{emailHash}        the person (name) — see trainingAuthService
 *
 * Storage: `training/recordings/{sessionId}/{emailHash}/{partId}/` holds the
 * attempt's screen recording (`seg-NNNNNN.webm|mp4`) and its screen-check
 * still (`check-{id}.jpg`) — see "Screen recording" below.
 *
 * THE CLOCK IS THE SERVER'S. `deadlineMs` is written once, at Start, in a
 * transaction; the browser only renders `deadline − (now + skew)`. A refresh,
 * a second tab and a wrong device clock cannot move it. Everything the
 * candidate can do afterwards is checked against it here.
 */

const SESSIONS_COLLECTION = 'training-sessions';
const PARTICIPANTS_COLLECTION = 'training-participants';

/** How long after the grace a candidate's `finalize` call is still honoured (a retry on a flaky line). */
const FINALIZE_WINDOW_MS = 5 * 60 * 1000;
/** Signed read URLs: from the start of the current window, this long. */
const READ_URL_TTL_MS = 2 * 60 * 60 * 1000;
const SIGNED_WRITE_TTL_MS = 15 * 60 * 1000;

const STORAGE_ROOT = 'training';

// ─── Stored shapes ───────────────────────────────────────────────────────────

interface SourceDoc {
  id: string;
  name: string;
  path: string;
  thumbPath: string;
  bytes: number;
  /** Removed after the part opened: offered to no new start, kept for attempts already using it (`sourcesForAttempt`). */
  removedAtMs?: number;
}

/** The images a part offers: everything an admin has not removed. What `pickCount` is judged against. */
function activeSources(sources: SourceDoc[]): SourceDoc[] {
  return sources.filter((s) => s.removedAtMs == null);
}

/**
 * The images one attempt may use. A removed image stays for an attempt whose
 * run (start, or latest reopen) began before the removal — the candidate may
 * have it open in their editor, and taking it away would break timed work —
 * and for any attempt that has already handed in an edit from it.
 */
function sourcesForAttempt(sources: SourceDoc[], attempt: AttemptDoc): SourceDoc[] {
  const runFrom = attempt.reopenedAtMs ?? attempt.startedAtMs;
  const used = new Set(Object.values(attempt.slots).map((s) => s?.sourceId));
  return sources.filter((s) => s.removedAtMs == null || s.removedAtMs > runFrom || used.has(s.id));
}

interface SessionDoc {
  label: string;
  moduleId: TrainingModuleId;
  createdAtMs: number;
  createdBy: string;
  closesAtMs: number;
  /** Set by Stop. A participant reopened BEFORE it does not outlive it. */
  stoppedAtMs?: number;
  participantCount: number;
  parts: Record<string, { opensAtMs: number; sources: SourceDoc[] }>;
}

interface PendingDoc {
  slotId: SlotId;
  sourceId: string;
  path: string;
  contentType: string;
  issuedAtMs: number;
}

interface SlotDoc {
  sourceId: string;
  path: string;
  bytes: number;
  uploadedAtMs: number;
}

interface AttemptDoc {
  startedAtMs: number;
  deadlineMs: number;
  finishedAtMs: number | null;
  reopenedAtMs?: number;
  /**
   * Set at Start (and on a reopen): edit uploads need a fresh recording segment.
   * Absent on attempts started before recording existed, which are never gated.
   */
  recording?: boolean;
  /** The next segment sequence number to sign. Never reset — a reopen continues it. */
  segmentSeq?: number;
  recordingDeletedAtMs?: number;
  uploadAttempts: number;
  pending: Record<string, PendingDoc>;
  slots: Partial<Record<SlotId, SlotDoc>>;
}

interface ParticipantDoc {
  sessionId: string;
  emailHash: string;
  email: string;
  addedAtMs: number;
  revokedAtMs: number | null;
  /** A reopen lets this one candidate in past the session's end, until here. */
  accessUntilMs?: number;
  reopenedAtMs?: number;
  /** Per part: the screen check that Start requires. Kept off `attempts`, whose keys mean "started". */
  screenChecks?: Record<string, ScreenCheckDoc>;
  attempts: Record<string, AttemptDoc>;
}

interface ScreenCheckDoc {
  /** When the last check still was verified. */
  atMs: number | null;
  path: string | null;
  /** The check signed but not yet confirmed. */
  pendingId: string | null;
  /** Checks ever signed for this part — the bound on a looping client. */
  count: number;
}

/**
 * The session as THIS participant sees it: when an admin reopened them after
 * the session ended, their own access end replaces the session's. A later Stop
 * ends them again — it is judged by which came last, not by who is bigger.
 */
function sessionFor(participant: ParticipantDoc, session: SessionDoc): SessionDoc {
  const until = participant.accessUntilMs;
  if (!until || until <= session.closesAtMs) return session;
  if (session.stoppedAtMs && session.stoppedAtMs > (participant.reopenedAtMs ?? 0)) return session;
  return { ...session, closesAtMs: until };
}


const participantId = (sessionId: string, emailHash: string) => `${sessionId}_${emailHash}`;

// ─── State derivation ────────────────────────────────────────────────────────

function derivePartState(
  now: number,
  session: SessionDoc,
  part: TrainingPartDef,
  attempt: AttemptDoc | undefined,
): PartState {
  if (attempt) {
    const filled = Object.keys(attempt.slots).length;
    if (attempt.finishedAtMs) return 'submitted';
    // A stopped session ends a running attempt where it stands, whatever its own clock says.
    if (now > Math.min(attempt.deadlineMs, session.closesAtMs)) return filled >= part.task.slots.length ? 'submitted' : 'timed-out';
    return 'in-progress';
  }
  const cfg = session.parts[part.id];
  if (now > session.closesAtMs) return 'missed';
  if (!cfg || now < cfg.opensAtMs) return 'scheduled';
  // A part can start once there is something to choose from: at least the number the task picks.
  if (activeSources(cfg.sources).length < part.task.pickCount) return 'not-ready';
  return 'open';
}

function summarisePart(
  now: number,
  session: SessionDoc,
  part: TrainingPartDef,
  attempt: AttemptDoc | undefined,
): PartSummary {
  const state = derivePartState(now, session, part, attempt);
  return {
    id: part.id,
    title: part.title,
    summary: part.summary,
    durationMs: part.durationMs,
    opensAtMs: session.parts[part.id]?.opensAtMs ?? 0,
    state,
    ...(state === 'in-progress' && attempt ? { deadlineMs: attempt.deadlineMs } : {}),
  };
}

// ─── Signing helpers ─────────────────────────────────────────────────────────

/**
 * A V4 signature covers the signing TIME, so signing on demand yields a
 * different URL string for the same file on every call — the browser then
 * re-downloads every image each time the admin page refreshes (the flicker
 * documented in model-submissions.md). Anchoring both ends to the start of a
 * 30-minute window makes every request inside it return byte-identical URLs.
 * The TTL outlives the window, so a URL minted in a window's last second still
 * has well over an hour left.
 */
const URL_WINDOW_MS = 30 * 60 * 1000;

async function signRead(path: string, opts?: { download?: string }): Promise<string> {
  const stamp = Math.floor(Date.now() / URL_WINDOW_MS) * URL_WINDOW_MS;
  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      accessibleAt: new Date(stamp),
      expires: new Date(stamp + READ_URL_TTL_MS),
      ...(opts?.download
        ? { responseDisposition: `attachment; filename="${opts.download.replace(/["\\\r\n]/g, '_')}"` }
        : {}),
    });
  return url;
}

async function signWrite(path: string, contentType: string, expiresAtMs: number): Promise<string> {
  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAtMs, contentType });
  return url;
}

function extFor(contentType: string): string | undefined {
  return (IMAGE_TYPES as Record<string, { ext: string } | undefined>)[contentType]?.ext;
}

/** The first bytes of an image, to prove what the declared type claims. */
async function sniffImage(path: string): Promise<ImageSniff | null> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    adminStorage
      .bucket()
      .file(path)
      .createReadStream({ start: 0, end: 15 })
      .on('data', (c: Buffer) => chunks.push(c))
      .on('end', () => resolve())
      .on('error', reject);
  });
  const b = Buffer.concat(chunks);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Whether the bytes at `path` are the image type its declared content type claims. */
async function isDeclaredImage(path: string, contentType: string): Promise<boolean> {
  const expected = (IMAGE_TYPES as Record<string, { sniff: ImageSniff } | undefined>)[contentType]?.sniff;
  return !!expected && (await sniffImage(path).catch(() => null)) === expected;
}

// ─── Candidate reads ─────────────────────────────────────────────────────────

/** The participations a candidate may act on right now: not revoked, session not closed. */
async function activeParticipations(emailHash: string, now: number) {
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).where('emailHash', '==', emailHash).get();
  const mine = snap.docs
    .map((d) => d.data() as ParticipantDoc)
    .filter((p) => p.revokedAtMs == null);
  if (mine.length === 0) return [];

  const sessionRefs = [...new Set(mine.map((p) => p.sessionId))].map((id) =>
    adminDb.collection(SESSIONS_COLLECTION).doc(id),
  );
  const sessionSnaps = await adminDb.getAll(...sessionRefs);
  const sessions = new Map<string, SessionDoc>();
  for (const s of sessionSnaps) if (s.exists) sessions.set(s.id, s.data() as SessionDoc);

  return mine
    .map((participant) => {
      const session = sessions.get(participant.sessionId);
      return { participant, session: session && sessionFor(participant, session) };
    })
    .filter(
      (x): x is { participant: ParticipantDoc; session: SessionDoc } =>
        !!x.session && x.session.closesAtMs > now,
    );
}

/** Whether this address is on any live session — decides whether a code is sent. */
export async function isApproved(emailHash: string): Promise<boolean> {
  return (await activeParticipations(emailHash, Date.now())).length > 0;
}

export async function getMe(emailHash: string): Promise<MeResponse> {
  const now = Date.now();
  const [active, name] = await Promise.all([activeParticipations(emailHash, now), getCandidateName(emailHash)]);

  const sessions: SessionSummary[] = active
    .map(({ participant, session }) => {
      const mod = getModule(session.moduleId);
      if (!mod) return null;
      return {
        id: participant.sessionId,
        label: session.label,
        moduleId: session.moduleId,
        closesAtMs: session.closesAtMs,
        parts: mod.parts.map((part) => summarisePart(now, session, part, participant.attempts?.[part.id])),
      };
    })
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => a.closesAtMs - b.closesAtMs);

  return { nowMs: now, email: active[0]?.participant.email ?? '', name, sessions };
}

/**
 * Picks the sitting `/training/<module>` should open when no session is named:
 * one with a part in progress, else one with a part open, else the soonest to
 * close. Two live sittings for one module is rare; this keeps it unsurprising.
 */
export function pickSession(
  sessions: SessionSummary[],
  moduleId: string,
  preferred?: string | null,
): SessionSummary | null {
  const forModule = sessions.filter((s) => s.moduleId === moduleId);
  if (forModule.length === 0) return null;
  const chosen = preferred ? forModule.find((s) => s.id === preferred) : undefined;
  if (chosen) return chosen;

  const rank = (s: SessionSummary) =>
    s.parts.some((p) => p.state === 'in-progress') ? 0 : s.parts.some((p) => p.state === 'open') ? 1 : 2;
  return [...forModule].sort((a, b) => rank(a) - rank(b) || a.closesAtMs - b.closesAtMs)[0];
}

async function loadParticipation(emailHash: string, sessionId: string) {
  const [pSnap, sSnap] = await adminDb.getAll(
    adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash)),
    adminDb.collection(SESSIONS_COLLECTION).doc(sessionId),
  );
  if (!pSnap.exists || !sSnap.exists) return null;
  const participant = pSnap.data() as ParticipantDoc;
  const session = sSnap.data() as SessionDoc;
  if (participant.revokedAtMs != null) return null;
  return { participant, session: sessionFor(participant, session) };
}

async function attemptView(attempt: AttemptDoc): Promise<AttemptView> {
  const slots = await Promise.all(
    (Object.entries(attempt.slots) as [SlotId, SlotDoc][]).map(async ([slotId, s]) => ({
      slotId,
      sourceId: s.sourceId,
      uploadedAtMs: s.uploadedAtMs,
      bytes: s.bytes,
      url: await signRead(s.path),
    })),
  );
  return {
    startedAtMs: attempt.startedAtMs,
    deadlineMs: attempt.deadlineMs,
    finishedAtMs: attempt.finishedAtMs,
    recording: !!attempt.recording,
    slots,
  };
}

async function sourceViews(sources: SourceDoc[]): Promise<SourceView[]> {
  return Promise.all(
    sources.map(async (s) => ({
      id: s.id,
      name: s.name,
      thumbUrl: await signRead(s.thumbPath),
      downloadUrl: await signRead(s.path, { download: s.name }),
    })),
  );
}

/**
 * One part for one candidate. The source images are signed ONLY while the
 * attempt is in progress — the briefing must not be able to leak them, and a
 * finished attempt has no reason to see them again.
 */
export async function getPartForCandidate(
  emailHash: string,
  sessionId: string,
  partId: string,
): Promise<PartResponse> {
  const ctx = await loadParticipation(emailHash, sessionId);
  if (!ctx) throw new TrainingError('Not found', 404);
  const { participant, session } = ctx;
  const part = getPart(session.moduleId, partId);
  if (!part) throw new TrainingError('Not found', 404);

  const now = Date.now();
  if (now > session.closesAtMs) throw new TrainingError('This session has closed', 410);

  const attempt = participant.attempts?.[partId];
  const summary = summarisePart(now, session, part, attempt);

  const [sources, attemptOut] = await Promise.all([
    summary.state === 'in-progress' && attempt
      ? sourceViews(sourcesForAttempt(session.parts[partId]?.sources ?? [], attempt))
      : undefined,
    attempt ? attemptView(attempt) : undefined,
  ]);
  return {
    nowMs: now,
    session: { id: sessionId, label: session.label, closesAtMs: session.closesAtMs },
    part: summary,
    ...(sources ? { sources } : {}),
    ...(attemptOut ? { attempt: attemptOut } : {}),
  };
}

// ─── The attempt ─────────────────────────────────────────────────────────────

/**
 * Starts the clock. Idempotent: a second Start (a double tap, a second tab)
 * returns the attempt already running rather than a fresh deadline. Only one
 * part may run at a time.
 */
export async function startAttempt(emailHash: string, sessionId: string, partId: string): Promise<void> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    const { participant, session, part } = candidateContext(pSnap, sSnap, partId);

    const now = Date.now();
    if (participant.attempts?.[partId]) return; // already started — idempotent
    if (now > session.closesAtMs) throw new TrainingError('This session has closed', 410);

    const state = derivePartState(now, session, part, undefined);
    if (state === 'scheduled') throw new TrainingError('This part has not opened yet', 409);
    if (state === 'not-ready') throw new TrainingError('This part is not ready yet. We will be in touch.', 409);
    if (state !== 'open') throw new TrainingError('This part cannot be started', 409);

    for (const [otherId, other] of Object.entries(participant.attempts ?? {})) {
      if (!other.finishedAtMs && now <= other.deadlineMs + UPLOAD_GRACE_MS) {
        throw new TrainingError(`Finish ${getPart(session.moduleId, otherId)?.title ?? 'your current part'} first`, 409);
      }
    }

    // The screen check is the server's half of "no Start without a working
    // recording". A page loaded before recording existed never runs one, so it
    // is told to refresh rather than given a bare refusal.
    const checkedAtMs = participant.screenChecks?.[partId]?.atMs ?? 0;
    if (now - checkedAtMs > SCREEN_CHECK_TTL_MS) {
      throw new TrainingError('Share your screen and run the screen check before you start. If you do not see it, refresh this page.', 409);
    }

    const attempt: AttemptDoc = {
      startedAtMs: now,
      deadlineMs: now + part.durationMs,
      finishedAtMs: null,
      recording: true,
      segmentSeq: 0,
      uploadAttempts: 0,
      pending: {},
      slots: {},
    };
    tx.update(pRef, { [`attempts.${partId}`]: attempt });
  });
}

function inProgress(attempt: AttemptDoc | undefined, now: number): attempt is AttemptDoc {
  return !!attempt && !attempt.finishedAtMs && now <= attempt.deadlineMs;
}

/**
 * Signs one upload slot. The URL's lifetime is capped at `deadline + grace`, so
 * a URL minted in the last minute cannot be used to upload long after the
 * clock ran out. The path is server-chosen and the content type is pinned into
 * the signature.
 */
export async function requestUpload(
  emailHash: string,
  sessionId: string,
  partId: string,
  input: { slotId: string; sourceId: string; contentType: string; size: number },
): Promise<{ uploadId: string; uploadUrl: string }> {
  const ext = extFor(input.contentType);
  if (!ext) throw new TrainingError(`Upload a ${IMAGE_LABEL} image`, 400);
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_OUTPUT_BYTES) {
    throw new TrainingError('That file is too large', 400);
  }

  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  const uploadId = crypto.randomBytes(12).toString('hex');
  const path = `${STORAGE_ROOT}/submissions/${sessionId}/${emailHash}/${partId}/${input.slotId}-${uploadId}.${ext}`;
  // Storage, not Firestore, so it is started now and runs alongside the
  // transaction's reads. Null when the listing itself failed: a Storage hiccup
  // must not lock an honest candidate out.
  const latestSegment = latestSegmentAtMs(recordingBase(sessionId, emailHash, partId)).catch((error) => {
    console.error('[training] segment listing failed', error);
    return null;
  });

  const deadlineMs = await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap, latestSegmentMs] = await Promise.all([tx.get(pRef), tx.get(sRef), latestSegment]);
    const { participant, session, part } = candidateContext(pSnap, sSnap, partId);
    const slot = part.task.slots.find((s) => s.id === input.slotId);
    if (!slot) throw new TrainingError('Not found', 404);

    const now = Date.now();
    const attempt = participant.attempts?.[partId];
    if (now > session.closesAtMs) throw new TrainingError('This session has been stopped', 409);
    if (!inProgress(attempt, now)) throw new TrainingError('Time is up', 409);
    if (!sourcesForAttempt(session.parts[partId]?.sources ?? [], attempt).some((s) => s.id === input.sourceId)) {
      throw new TrainingError('Choose one of the source images', 400);
    }
    // Measured from the start (or reopen) until the first segment lands, which takes a segment's length.
    const recordedUntil = Math.max(latestSegmentMs ?? 0, attempt.startedAtMs, attempt.reopenedAtMs ?? 0);
    if (attempt.recording && latestSegmentMs !== null && now - recordedUntil > RECORDING_STALE_MS) {
      throw new TrainingError('Your screen is not being recorded right now. Share your screen again to keep uploading.', 409);
    }
    if (attempt.uploadAttempts >= MAX_UPLOAD_ATTEMPTS) {
      throw new TrainingError('Too many uploads. Keep the ones you have.', 429);
    }

    tx.update(pRef, {
      [`attempts.${partId}.uploadAttempts`]: attempt.uploadAttempts + 1,
      [`attempts.${partId}.pending.${uploadId}`]: {
        slotId: slot.id,
        sourceId: input.sourceId,
        path,
        contentType: input.contentType,
        issuedAtMs: now,
      } satisfies PendingDoc,
    });
    return attempt.deadlineMs;
  });

  const expires = Math.min(Date.now() + SIGNED_WRITE_TTL_MS, deadlineMs + UPLOAD_GRACE_MS);
  return { uploadId, uploadUrl: await signWrite(path, input.contentType, expires) };
}

/**
 * Accepts an upload the browser says it finished. Nothing is taken on trust:
 * the object must exist at the server-chosen path, be within the size limit,
 * carry the declared type, START with that type's magic bytes, and have been
 * CREATED by `deadline + grace`. Bytes are never downloaded through a function
 * (rule 9i) — only metadata and a 16-byte range.
 */
export async function finalizeUpload(
  emailHash: string,
  sessionId: string,
  partId: string,
  uploadId: string,
): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(uploadId)) throw new TrainingError('Invalid upload', 400);

  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const current = (await pRef.get()).data() as ParticipantDoc | undefined;
  if (!current || current.revokedAtMs != null) throw new TrainingError('Not found', 404);
  const attempt = current.attempts?.[partId];
  const pending = attempt?.pending?.[uploadId];
  if (!attempt || !pending) throw new TrainingError('Invalid upload', 400);

  const now = Date.now();
  if (now > attempt.deadlineMs + UPLOAD_GRACE_MS + FINALIZE_WINDOW_MS) throw new TrainingError('Time is up', 409);

  const file = adminStorage.bucket().file(pending.path);

  const drop = async (message: string, status = 400): Promise<never> => {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    await pRef.update({ [`attempts.${partId}.pending.${uploadId}`]: FieldValue.delete() }).catch(() => {});
    throw new TrainingError(message, status);
  };

  // Independent round trips to Storage: the object's metadata and its first bytes.
  let meta;
  let isImage: boolean;
  try {
    [[meta], isImage] = await Promise.all([file.getMetadata(), isDeclaredImage(pending.path, pending.contentType)]);
  } catch {
    throw new TrainingError('That upload did not arrive. Try again.', 400);
  }
  const size = Number(meta.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_OUTPUT_BYTES) return drop('That file is too large');
  if (meta.contentType !== pending.contentType) return drop('That file type is not accepted');
  const createdMs = Date.parse(String(meta.timeCreated));
  if (!Number.isFinite(createdMs) || createdMs > attempt.deadlineMs + UPLOAD_GRACE_MS) {
    return drop('That upload finished after time was up', 409);
  }
  if (!isImage) return drop('That file is not a valid image');

  let replaced: string | null = null;
  try {
    await adminDb.runTransaction(async (tx) => {
      const [pSnap, sSnap] = await Promise.all([
        tx.get(pRef),
        tx.get(adminDb.collection(SESSIONS_COLLECTION).doc(sessionId)),
      ]);
      const participant = pSnap.data() as ParticipantDoc | undefined;
      const rawSession = sSnap.data() as SessionDoc | undefined;
      const fresh = participant?.attempts?.[partId];
      if (!participant || !rawSession || !fresh?.pending?.[uploadId]) throw new TrainingError('Invalid upload', 400);
      const session = sessionFor(participant, rawSession);

      const part = getPart(session.moduleId, partId);
      if (!part) throw new TrainingError('Not found', 404);
      // An upload already travelling when the session was stopped may land inside the grace; nothing later.
      if (Date.now() > session.closesAtMs + UPLOAD_GRACE_MS) throw new TrainingError('This session has been stopped', 409);
      const { pickCount, editsPerSource } = part.task;

      // The picked sources are DERIVED from the slots, never trusted as a field:
      // at most `pickCount` distinct sources, each used at most `editsPerSource` times.
      const next: Partial<Record<SlotId, SlotDoc>> = { ...fresh.slots };
      replaced = next[pending.slotId]?.path ?? null;
      next[pending.slotId] = {
        sourceId: pending.sourceId,
        path: pending.path,
        bytes: size,
        uploadedAtMs: Date.now(),
      };
      const perSource = new Map<string, number>();
      for (const s of Object.values(next)) perSource.set(s.sourceId, (perSource.get(s.sourceId) ?? 0) + 1);
      if (perSource.size > pickCount) {
        throw new TrainingError(`Use only ${pickCount} source images`, 409);
      }
      if ([...perSource.values()].some((n) => n > editsPerSource)) {
        throw new TrainingError(`Each image gets ${editsPerSource} edits`, 409);
      }

      tx.update(pRef, {
        [`attempts.${partId}.slots.${pending.slotId}`]: next[pending.slotId],
        [`attempts.${partId}.pending.${uploadId}`]: FieldValue.delete(),
      });
    });
  } catch (error) {
    if (error instanceof TrainingError && error.status === 409) {
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      await pRef.update({ [`attempts.${partId}.pending.${uploadId}`]: FieldValue.delete() }).catch(() => {});
    }
    throw error;
  }

  if (replaced && replaced !== pending.path) {
    await adminStorage.bucket().file(replaced).delete({ ignoreNotFound: true }).catch(() => {});
  }
}

/** Ends the part early. Irreversible; leaves whatever was uploaded. */
export async function finishAttempt(emailHash: string, sessionId: string, partId: string): Promise<void> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(pRef);
    const participant = snap.data() as ParticipantDoc | undefined;
    if (!participant || participant.revokedAtMs != null) throw new TrainingError('Not found', 404);
    const attempt = participant.attempts?.[partId];
    if (!attempt) throw new TrainingError('Not started', 409);
    if (attempt.finishedAtMs) return;
    if (Date.now() > attempt.deadlineMs) return; // the clock already ended it
    tx.update(pRef, { [`attempts.${partId}.finishedAtMs`]: Date.now() });
  });
}

// ─── Screen recording ────────────────────────────────────────────────────────
//
// The candidate's browser holds a whole-screen share (`getDisplayMedia`) and
// records it as short, independently playable segments, each PUT straight to
// Storage over a URL signed here (rule 9i: no video crosses a function). The
// segments ARE the record: nothing per segment is written to Firestore, and the
// admin player lists the folder. Two gates make it compulsory:
//   - Start needs a screen check verified in the last few minutes.
//   - An edit upload needs a segment that landed in the last RECORDING_STALE_MS.

const recordingBase = (sessionId: string, emailHash: string, partId: string) =>
  `${STORAGE_ROOT}/recordings/${sessionId}/${emailHash}/${partId}`;

/** When the newest segment finished uploading, by Storage's clock — 0 when there is none. */
async function latestSegmentAtMs(base: string): Promise<number> {
  // Only the two fields read here: a long attempt holds hundreds of segments.
  const [files] = await adminStorage.bucket().getFiles({ prefix: `${base}/seg-`, fields: 'items(name,timeCreated),nextPageToken' });
  let latest = 0;
  for (const f of files) latest = Math.max(latest, Date.parse(String(f.metadata.timeCreated)) || 0);
  return latest;
}

const CHECK_ID = /^[a-f0-9]{24}$/;
const CHECK_UPLOAD_TTL_MS = 5 * 60_000;

const checkPath = (sessionId: string, emailHash: string, partId: string, checkId: string) =>
  `${recordingBase(sessionId, emailHash, partId)}/check-${checkId}.jpg`;

/** When an attempt stops or stopped: finished early, its deadline, or the session's end — whichever came first. */
const attemptEndMs = (attempt: AttemptDoc, session: SessionDoc) =>
  attempt.finishedAtMs ?? Math.min(attempt.deadlineMs, session.closesAtMs);

/** One participant's attempt at one part, for the admin recording routes. */
async function loadAdminAttempt(sessionId: string, emailHash: string, partId: string) {
  if (!/^[a-f0-9]{32}$/.test(emailHash)) throw new TrainingError('Not found', 404);
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const [pSnap, session] = await Promise.all([pRef.get(), loadSession(sessionId)]);
  const part = getPart(session.moduleId, partId);
  if (!pSnap.exists || !part) throw new TrainingError('Not found', 404);
  const participant = pSnap.data() as ParticipantDoc;
  return { pRef, participant, part, attempt: participant.attempts?.[partId], session: sessionFor(participant, session) };
}

/** Loads one participation for a candidate write, refusing a revoked one or an unknown part. */
function candidateContext(pSnap: FirebaseFirestore.DocumentSnapshot, sSnap: FirebaseFirestore.DocumentSnapshot, partId: string) {
  if (!pSnap.exists || !sSnap.exists) throw new TrainingError('Not found', 404);
  const participant = pSnap.data() as ParticipantDoc;
  if (participant.revokedAtMs != null) throw new TrainingError('Not found', 404);
  const session = sessionFor(participant, sSnap.data() as SessionDoc);
  const part = getPart(session.moduleId, partId);
  if (!part) throw new TrainingError('Not found', 404);
  return { participant, session, part };
}

/**
 * Signs the upload of one screen-check still: a frame the browser grabbed from
 * the share it will record. Only before the part is started — afterwards the
 * segments themselves are the evidence.
 */
export async function signScreenCheck(
  emailHash: string,
  sessionId: string,
  partId: string,
): Promise<{ checkId: string; uploadUrl: string }> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  const checkId = crypto.randomBytes(12).toString('hex');

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    const { participant, session } = candidateContext(pSnap, sSnap, partId);
    if (Date.now() > session.closesAtMs) throw new TrainingError('This session has closed', 410);
    if (participant.attempts?.[partId]) throw new TrainingError('This part has already started', 409);
    const check = participant.screenChecks?.[partId];
    const count = check?.count ?? 0;
    if (count >= MAX_SCREEN_CHECKS) throw new TrainingError('Too many screen checks. Contact the team.', 429);
    tx.update(pRef, {
      [`screenChecks.${partId}`]: {
        atMs: check?.atMs ?? null,
        path: check?.path ?? null,
        pendingId: checkId,
        count: count + 1,
      } satisfies ScreenCheckDoc,
    });
  });

  const path = checkPath(sessionId, emailHash, partId, checkId);
  return { checkId, uploadUrl: await signWrite(path, 'image/jpeg', Date.now() + CHECK_UPLOAD_TTL_MS) };
}

/** Verifies the still arrived and is a real JPEG, then records the check Start looks for. */
export async function confirmScreenCheck(
  emailHash: string,
  sessionId: string,
  partId: string,
  checkId: string,
): Promise<{ checkedAtMs: number }> {
  if (!CHECK_ID.test(checkId)) throw new TrainingError('Invalid check', 400);
  const path = checkPath(sessionId, emailHash, partId, checkId);
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

  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  const now = Date.now();
  const previous = await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    const { participant } = candidateContext(pSnap, sSnap, partId);
    const check = participant.screenChecks?.[partId];
    if (!check || check.pendingId !== checkId) throw new TrainingError('Invalid check', 400);
    tx.update(pRef, {
      [`screenChecks.${partId}`]: { atMs: now, path, pendingId: null, count: check.count } satisfies ScreenCheckDoc,
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
 * server's, so a segment can never overwrite another, and every URL dies at
 * `deadline + grace` like the edit uploads' do.
 */
export async function requestRecordingSlots(
  emailHash: string,
  sessionId: string,
  partId: string,
  contentType: RecordingType,
): Promise<RecordingSlots> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);

  const { first, endsAtMs } = await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    const { participant, session } = candidateContext(pSnap, sSnap, partId);
    const attempt = participant.attempts?.[partId];
    const now = Date.now();
    if (now > session.closesAtMs || !inProgress(attempt, now)) throw new TrainingError('Time is up', 409);
    if (!attempt.recording) throw new TrainingError('This attempt is not recorded', 409);
    const seq = attempt.segmentSeq ?? 0;
    if (seq + SEGMENT_BATCH > MAX_SEGMENTS_PER_ATTEMPT) throw new TrainingError('The recording is full', 429);
    tx.update(pRef, { [`attempts.${partId}.segmentSeq`]: seq + SEGMENT_BATCH });
    return { first: seq, endsAtMs: attemptEndMs(attempt, session) };
  });

  const base = recordingBase(sessionId, emailHash, partId);
  const expires = Math.min(Date.now() + SEGMENT_URL_TTL_MS, endsAtMs + UPLOAD_GRACE_MS);
  const slots = await Promise.all(
    Array.from({ length: SEGMENT_BATCH }, async (_, i) => ({
      seq: first + i,
      url: await signWrite(`${base}/${segmentName(first + i, contentType)}`, contentType, expires),
    })),
  );
  return { slots };
}

/**
 * One attempt's recording for the admin player. `after` returns only the
 * segments past that sequence number — the live view polls with it, so a poll
 * carries the new ten seconds, not the whole sitting (rule 9i). URLs are
 * window-anchored (`signRead`), so a repeated read returns identical strings.
 */
export async function getRecording(
  sessionId: string,
  emailHash: string,
  partId: string,
  after: number | null,
): Promise<AdminRecordingView> {
  const { participant, part, attempt, session } = await loadAdminAttempt(sessionId, emailHash, partId);
  const now = Date.now();
  const live = !!attempt && derivePartState(now, session, part, attempt) === 'in-progress';

  const base = recordingBase(sessionId, emailHash, partId);
  const [files] = await adminStorage.bucket().getFiles({
    prefix: `${base}/seg-`,
    // Lexical, and the names are zero-padded: everything from the next number on.
    ...(after !== null ? { startOffset: `${base}/seg-${String(after + 1).padStart(6, '0')}` } : {}),
  });
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

  const check = participant.screenChecks?.[partId];
  return {
    nowMs: now,
    live,
    recorded: !!attempt?.recording,
    startedAtMs: attempt?.startedAtMs ?? null,
    reopenedAtMs: attempt?.reopenedAtMs ?? null,
    endsAtMs: attempt ? attemptEndMs(attempt, session) : null,
    deletedAtMs: attempt?.recordingDeletedAtMs ?? null,
    ...(after === null
      ? { check: check?.atMs && check.path ? { atMs: check.atMs, url: await signRead(check.path) } : null }
      : {}),
    segments,
  };
}

/**
 * Deletes one attempt's recording and its check still. Refused while the part
 * is running (and through the upload grace): the candidate is still recording,
 * and an empty folder would lock their uploads. The submitted work is untouched.
 */
export async function deleteRecording(sessionId: string, emailHash: string, partId: string): Promise<void> {
  const { pRef, attempt, session } = await loadAdminAttempt(sessionId, emailHash, partId);
  if (attempt && Date.now() <= attemptEndMs(attempt, session) + UPLOAD_GRACE_MS) {
    throw new TrainingError('This part is still running. Delete the recording once it has ended.', 409);
  }

  await adminStorage.bucket().deleteFiles({ prefix: `${recordingBase(sessionId, emailHash, partId)}/` });
  await pRef.update({
    ...(attempt ? { [`attempts.${partId}.recordingDeletedAtMs`]: Date.now() } : {}),
    [`screenChecks.${partId}`]: FieldValue.delete(),
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

/** Splits a pasted blob into distinct, normalised addresses. Reports the ones it cannot read. */
function parseEmails(raw: string): {
  valid: { email: string; emailKey: string; emailHash: string }[];
  invalid: string[];
} {
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

export async function listSessions(): Promise<AdminSessionRow[]> {
  const snap = await adminDb.collection(SESSIONS_COLLECTION).orderBy('createdAtMs', 'desc').limit(100).get();
  return snap.docs.map((d) => {
    const s = d.data() as SessionDoc;
    const opens = Object.values(s.parts ?? {}).map((p) => p.opensAtMs);
    return {
      id: d.id,
      label: s.label,
      moduleId: s.moduleId,
      createdAtMs: s.createdAtMs,
      closesAtMs: s.closesAtMs,
      participantCount: s.participantCount ?? 0,
      firstOpensAtMs: opens.length ? Math.min(...opens) : 0,
    };
  });
}

export async function createSession(input: {
  label: string;
  moduleId: string;
  emails: string;
  opensAtMs: Record<string, number>;
  closesAtMs: number;
  createdBy: string;
}): Promise<{ id: string }> {
  const mod = getModule(input.moduleId);
  if (!mod) throw new TrainingError('Choose a module', 400);

  const label = input.label.trim().slice(0, 80);
  if (!label) throw new TrainingError('Give the session a name', 400);

  const parts: SessionDoc['parts'] = {};
  for (const part of mod.parts) {
    const opensAtMs = input.opensAtMs[part.id];
    if (!Number.isFinite(opensAtMs)) throw new TrainingError(`Set when ${part.title} opens`, 400);
    parts[part.id] = { opensAtMs, sources: [] };
  }
  const lastOpen = Math.max(...Object.values(parts).map((p) => p.opensAtMs));
  if (!Number.isFinite(input.closesAtMs) || input.closesAtMs <= lastOpen) {
    throw new TrainingError('Access must end after the last part opens', 400);
  }

  const { valid, invalid } = parseEmails(input.emails);
  if (invalid.length) throw new TrainingError(`These are not valid emails: ${invalid.slice(0, 5).join(', ')}`, 400);
  if (valid.length === 0) throw new TrainingError('Add at least one email', 400);
  if (valid.length > MAX_PARTICIPANTS_PER_SESSION) {
    throw new TrainingError(`At most ${MAX_PARTICIPANTS_PER_SESSION} people per session`, 400);
  }

  const id = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const batch = adminDb.batch();
  batch.set(adminDb.collection(SESSIONS_COLLECTION).doc(id), {
    label,
    moduleId: mod.id,
    createdAtMs: now,
    createdBy: input.createdBy,
    closesAtMs: input.closesAtMs,
    participantCount: valid.length,
    parts,
  } satisfies SessionDoc);
  for (const v of valid) {
    batch.set(adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(id, v.emailHash)), {
      sessionId: id,
      emailHash: v.emailHash,
      email: v.email,
      addedAtMs: now,
      revokedAtMs: null,
      attempts: {},
    } satisfies ParticipantDoc);
  }
  await batch.commit();
  return { id };
}

async function loadSession(id: string): Promise<SessionDoc> {
  const snap = await adminDb.collection(SESSIONS_COLLECTION).doc(id).get();
  if (!snap.exists) throw new TrainingError('Not found', 404);
  return snap.data() as SessionDoc;
}

export async function getSessionDetail(id: string): Promise<AdminSessionDetail>;
export async function getSessionDetail(id: string, opts: { progressOnly: true }): Promise<AdminSessionProgress>;
/** The roster and its states; `progressOnly` skips the source images (the poll — see `AdminSessionProgress`). */
export async function getSessionDetail(
  id: string,
  opts?: { progressOnly: true },
): Promise<AdminSessionDetail | AdminSessionProgress> {
  const [session, pSnap] = await Promise.all([
    loadSession(id),
    adminDb.collection(PARTICIPANTS_COLLECTION).where('sessionId', '==', id).get(),
  ]);
  const mod = getModule(session.moduleId);
  const now = Date.now();
  const participantsRaw = pSnap.docs.map((d) => d.data() as ParticipantDoc);
  const names = await getCandidateNames(participantsRaw.map((p) => p.emailHash));

  const participants: AdminParticipant[] = participantsRaw
    .map((p) => ({
      emailHash: p.emailHash,
      email: p.email,
      name: names.get(p.emailHash) ?? null,
      addedAtMs: p.addedAtMs,
      revokedAtMs: p.revokedAtMs,
      parts: Object.fromEntries(
        (mod?.parts ?? []).map((part) => {
          const attempt = p.attempts?.[part.id];
          return [
            part.id,
            {
              state: derivePartState(now, sessionFor(p, session), part, attempt),
              reopenedAtMs: attempt?.reopenedAtMs ?? null,
              startedAtMs: attempt?.startedAtMs ?? null,
              deadlineMs: attempt?.deadlineMs ?? null,
              finishedAtMs: attempt?.finishedAtMs ?? null,
              slotsFilled: attempt ? Object.keys(attempt.slots).length : 0,
            },
          ];
        }),
      ),
    }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  const head = {
    id,
    label: session.label,
    moduleId: session.moduleId,
    createdAtMs: session.createdAtMs,
    closesAtMs: session.closesAtMs,
  };
  if (opts?.progressOnly) return { nowMs: now, session: head, participants };

  const parts: AdminSessionDetail['session']['parts'] = {};
  await Promise.all(
    Object.entries(session.parts).map(async ([partId, cfg]) => {
      parts[partId] = {
        opensAtMs: cfg.opensAtMs,
        sources: await Promise.all(
          activeSources(cfg.sources).map(async (s) => ({ id: s.id, name: s.name, thumbUrl: await signRead(s.thumbPath) })),
        ),
      };
    }),
  );

  return { nowMs: now, session: { ...head, parts }, participants };
}

/**
 * The parts anyone has started. A part's open time and its source images are
 * fixed only from that moment — a running attempt has read the images and
 * counted its clock against the schedule — and not merely once it opens, which
 * would strand an admin who opened a part before attaching the images.
 */
async function startedParts(sessionId: string): Promise<Set<string>> {
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).where('sessionId', '==', sessionId).get();
  const started = new Set<string>();
  for (const d of snap.docs) {
    for (const partId of Object.keys((d.data() as ParticipantDoc).attempts ?? {})) started.add(partId);
  }
  return started;
}

export async function updateSession(
  id: string,
  patch: { label?: string; closesAtMs?: number; opensAtMs?: Record<string, number> },
): Promise<void> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(id);
  const started = patch.opensAtMs ? await startedParts(id) : new Set<string>();
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TrainingError('Not found', 404);
    const session = snap.data() as SessionDoc;
    const update: Record<string, unknown> = {};

    if (patch.label !== undefined) {
      const label = patch.label.trim().slice(0, 80);
      if (!label) throw new TrainingError('Give the session a name', 400);
      update.label = label;
    }
    let lastOpen = Math.max(...Object.values(session.parts).map((p) => p.opensAtMs));
    for (const [partId, opensAtMs] of Object.entries(patch.opensAtMs ?? {})) {
      const cfg = session.parts[partId];
      if (!cfg || !Number.isFinite(opensAtMs)) throw new TrainingError('Unknown part', 400);
      if (opensAtMs !== cfg.opensAtMs && started.has(partId)) {
        throw new TrainingError('Someone has already started that part, so its open time is fixed', 409);
      }
      update[`parts.${partId}.opensAtMs`] = opensAtMs;
    }
    if (patch.opensAtMs) {
      lastOpen = Math.max(
        ...Object.entries(session.parts).map(([pid, p]) => patch.opensAtMs?.[pid] ?? p.opensAtMs),
      );
    }
    const closesAtMs = patch.closesAtMs ?? session.closesAtMs;
    // Only judged when the schedule is being changed: a stopped session ends before its parts
    // would have opened, and renaming it must still work.
    if ((patch.opensAtMs || (patch.closesAtMs !== undefined && patch.closesAtMs !== session.closesAtMs)) &&
        (!Number.isFinite(closesAtMs) || closesAtMs <= lastOpen)) {
      throw new TrainingError('Access must end after the last part opens', 400);
    }
    if (patch.closesAtMs !== undefined) update.closesAtMs = closesAtMs;

    if (Object.keys(update).length) tx.update(ref, update);
  });
}

/**
 * Ends the session now: access stops for everyone on their next request, a
 * running attempt ends where it stands, and what was uploaded is kept. It is
 * just `closesAtMs = now`, so every existing guard already honours it, and
 * setting a later "Access ends" reopens the session. Idempotent.
 */
export async function stopSession(id: string): Promise<void> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(id);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TrainingError('Not found', 404);
    const now = Date.now();
    if ((snap.data() as SessionDoc).closesAtMs <= now) return;
    tx.update(ref, { closesAtMs: now, stoppedAtMs: now });
  });
}

/** How long a reopened candidate may get in for — long enough to sign in and start, not an open door. */
const REOPEN_ACCESS_MS = 24 * 60 * 60 * 1000;

/**
 * Reopens one candidate's part: the SAME attempt, with its uploads, on a fresh
 * full clock. Works after the session has ended (a candidate-level access
 * extension, see `sessionFor`), and for a part they never started (they get to
 * Start it). Refused while the part is genuinely running, or while another part
 * of theirs is — only one runs at a time.
 */
export async function reopenParticipant(sessionId: string, emailHash: string, partId: string): Promise<void> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);

  await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    if (!pSnap.exists || !sSnap.exists) throw new TrainingError('Not found', 404);
    const participant = pSnap.data() as ParticipantDoc;
    const session = sessionFor(participant, sSnap.data() as SessionDoc);
    if (participant.revokedAtMs != null) throw new TrainingError('Restore them first', 409);
    const part = getPart(session.moduleId, partId);
    if (!part) throw new TrainingError('Not found', 404);

    const now = Date.now();
    const running = (a: AttemptDoc | undefined) =>
      !!a && !a.finishedAtMs && now <= Math.min(a.deadlineMs, session.closesAtMs);
    if (running(participant.attempts?.[partId])) throw new TrainingError('That part is already running for them', 409);
    for (const [otherId, other] of Object.entries(participant.attempts ?? {})) {
      if (otherId !== partId && running(other)) {
        throw new TrainingError(`They are in the middle of ${getPart(session.moduleId, otherId)?.title ?? 'another part'}`, 409);
      }
    }

    const update: Record<string, unknown> = { accessUntilMs: now + REOPEN_ACCESS_MS, reopenedAtMs: now };
    if (participant.attempts?.[partId]) {
      update[`attempts.${partId}.deadlineMs`] = now + part.durationMs;
      update[`attempts.${partId}.finishedAtMs`] = null;
      update[`attempts.${partId}.reopenedAtMs`] = now;
      update[`attempts.${partId}.uploadAttempts`] = 0;
      update[`attempts.${partId}.pending`] = {};
      // The fresh clock is recorded like any other. `segmentSeq` is left alone,
      // so the new run's segments continue after the old ones instead of over them.
      update[`attempts.${partId}.recording`] = true;
      update[`attempts.${partId}.recordingDeletedAtMs`] = FieldValue.delete();
    }
    tx.update(pRef, update);
  });
}

export async function addParticipants(sessionId: string, raw: string): Promise<{ added: number }> {
  const { valid, invalid } = parseEmails(raw);
  if (invalid.length) throw new TrainingError(`These are not valid emails: ${invalid.slice(0, 5).join(', ')}`, 400);
  if (valid.length === 0) throw new TrainingError('Add at least one email', 400);

  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  return adminDb.runTransaction(async (tx) => {
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists) throw new TrainingError('Not found', 404);
    const refs = valid.map((v) => adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, v.emailHash)));
    const snaps = await tx.getAll(...refs);

    let added = 0;
    const now = Date.now();
    snaps.forEach((snap, i) => {
      if (snap.exists) {
        // Re-adding a revoked person restores them with their attempts intact.
        if ((snap.data() as ParticipantDoc).revokedAtMs != null) {
          tx.update(refs[i], { revokedAtMs: null });
          added++;
        }
        return;
      }
      tx.set(refs[i], {
        sessionId,
        emailHash: valid[i].emailHash,
        email: valid[i].email,
        addedAtMs: now,
        revokedAtMs: null,
        attempts: {},
      } satisfies ParticipantDoc);
      added++;
    });

    const count = ((sSnap.data() as SessionDoc).participantCount ?? 0) + added;
    if (count > MAX_PARTICIPANTS_PER_SESSION) {
      throw new TrainingError(`At most ${MAX_PARTICIPANTS_PER_SESSION} people per session`, 400);
    }
    tx.update(sRef, { participantCount: count });
    return { added };
  });
}

/** Revokes access. The record and any submitted work stay, so the admin can still review them. */
export async function revokeParticipant(sessionId: string, emailHash: string): Promise<void> {
  const pRef = adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash));
  const sRef = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  await adminDb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
    if (!pSnap.exists || !sSnap.exists) throw new TrainingError('Not found', 404);
    if ((pSnap.data() as ParticipantDoc).revokedAtMs != null) return;
    tx.update(pRef, { revokedAtMs: Date.now() });
    tx.update(sRef, { participantCount: Math.max(0, ((sSnap.data() as SessionDoc).participantCount ?? 1) - 1) });
  });
}

export async function getSubmission(
  sessionId: string,
  emailHash: string,
  partId: string,
): Promise<AdminSubmissionView> {
  if (!/^[a-f0-9]{32}$/.test(emailHash)) throw new TrainingError('Not found', 404);
  const [pSnap, session] = await Promise.all([
    adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(sessionId, emailHash)).get(),
    loadSession(sessionId),
  ]);
  if (!pSnap.exists || !getPart(session.moduleId, partId)) throw new TrainingError('Not found', 404);
  const participant = pSnap.data() as ParticipantDoc;
  const attempt = participant.attempts?.[partId];

  const entries = Object.entries(attempt?.slots ?? {}) as [SlotId, SlotDoc][];
  const usedSources = new Set(entries.map(([, s]) => s.sourceId));
  const [slots, sources] = await Promise.all([
    Promise.all(
      entries.map(async ([slotId, s]) => ({
        slotId,
        sourceId: s.sourceId,
        uploadedAtMs: s.uploadedAtMs,
        bytes: s.bytes,
        url: await signRead(s.path),
      })),
    ),
    Promise.all(
      (session.parts[partId]?.sources ?? [])
        .filter((s) => usedSources.has(s.id))
        .map(async (s) => ({ id: s.id, name: s.name, thumbUrl: await signRead(s.thumbPath) })),
    ),
  ]);

  return {
    startedAtMs: attempt?.startedAtMs ?? null,
    finishedAtMs: attempt?.finishedAtMs ?? null,
    slots,
    sources,
  };
}

// ─── Candidates across sessions (admin) ──────────────────────────────────────

/** Most pressing first: a live clock, then something to start, then what is coming, then what ended. */
const STATUS_RANK: Record<CandidateStatus, number> = {
  'in-progress': 0,
  open: 1,
  'not-ready': 2,
  scheduled: 3,
  submitted: 4,
  'timed-out': 5,
  missed: 6,
  removed: 7,
};

/** The most recent sign of life on an attempt. */
function lastTouch(attempt: AttemptDoc): number {
  return Math.max(
    attempt.startedAtMs,
    attempt.finishedAtMs ?? 0,
    attempt.reopenedAtMs ?? 0,
    ...Object.values(attempt.slots).map((s) => s.uploadedAtMs),
  );
}

/** Upper bound on participant documents one list reads. A trial pool is tens of people, not thousands. */
const CANDIDATE_SCAN_LIMIT = 2000;

/**
 * Every candidate, one row each, with the standing of their most pressing part.
 * One collection read, one batched read of the sessions and one of the names
 * (rule 9). The Candidates tab re-reads it on a slow beat, and only while
 * someone's part is open or running.
 */
export async function listCandidates(): Promise<{ nowMs: number; candidates: AdminCandidateRow[] }> {
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).limit(CANDIDATE_SCAN_LIMIT).get();
  const participants = snap.docs.map((d) => d.data() as ParticipantDoc);

  const sessionIds = [...new Set(participants.map((p) => p.sessionId))];
  const [sessionSnaps, names] = await Promise.all([
    sessionIds.length
      ? adminDb.getAll(...sessionIds.map((id) => adminDb.collection(SESSIONS_COLLECTION).doc(id)))
      : Promise.resolve([]),
    getCandidateNames([...new Set(participants.map((p) => p.emailHash))]),
  ]);
  const sessions = new Map<string, SessionDoc>();
  for (const s of sessionSnaps) if (s.exists) sessions.set(s.id, s.data() as SessionDoc);

  const now = Date.now();
  const byCandidate = new Map<string, ParticipantDoc[]>();
  for (const p of participants) byCandidate.set(p.emailHash, [...(byCandidate.get(p.emailHash) ?? []), p]);

  const rows: AdminCandidateRow[] = [];
  for (const [emailHash, mine] of byCandidate) {
    let best: { rank: number; state: CandidateStatus; detail: string } | null = null;
    let partsSubmitted = 0;
    let partsTotal = 0;
    let sessionCount = 0;
    let lastActivityMs = 0;

    for (const p of mine) {
      lastActivityMs = Math.max(lastActivityMs, p.addedAtMs, ...Object.values(p.attempts ?? {}).map(lastTouch));
      const raw = sessions.get(p.sessionId);
      if (!raw || p.revokedAtMs != null) continue;
      const session = sessionFor(p, raw);
      const mod = getModule(session.moduleId);
      if (!mod) continue;
      sessionCount += 1;
      for (const part of mod.parts) {
        const state = derivePartState(now, session, part, p.attempts?.[part.id]);
        partsTotal += 1;
        if (state === 'submitted') partsSubmitted += 1;
        const rank = STATUS_RANK[state];
        if (!best || rank < best.rank) best = { rank, state, detail: `${part.title} · ${session.label}` };
      }
    }

    rows.push({
      emailHash,
      email: mine[0].email,
      name: names.get(emailHash) ?? null,
      status: best?.state ?? 'removed',
      statusDetail: best?.detail ?? '',
      sessionCount,
      partsSubmitted,
      partsTotal,
      lastActivityMs,
    });
  }

  rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.lastActivityMs - a.lastActivityMs ||
      (a.name ?? a.email).localeCompare(b.name ?? b.email),
  );
  return { nowMs: now, candidates: rows };
}

/** Everything one candidate has submitted, across every session they have been on. */
export async function getCandidateDetail(emailHash: string): Promise<AdminCandidateDetail> {
  if (!/^[a-f0-9]{32}$/.test(emailHash)) throw new TrainingError('Not found', 404);
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).where('emailHash', '==', emailHash).get();
  const participants = snap.docs.map((d) => d.data() as ParticipantDoc);
  if (participants.length === 0) throw new TrainingError('Not found', 404);

  const sessionSnaps = await adminDb.getAll(
    ...[...new Set(participants.map((p) => p.sessionId))].map((id) => adminDb.collection(SESSIONS_COLLECTION).doc(id)),
  );
  const sessions = new Map<string, SessionDoc>();
  for (const s of sessionSnaps) if (s.exists) sessions.set(s.id, s.data() as SessionDoc);

  const now = Date.now();
  const built = await Promise.all(
    participants.map(async (p): Promise<AdminCandidateSession | null> => {
      const raw = sessions.get(p.sessionId);
      const mod = raw ? getModule(raw.moduleId) : null;
      if (!raw || !mod) return null;
      const session = sessionFor(p, raw);

      const parts = await Promise.all(
        mod.parts.map(async (part): Promise<AdminCandidatePart> => {
          const attempt = p.attempts?.[part.id];
          const entries = Object.entries(attempt?.slots ?? {}) as [SlotId, SlotDoc][];
          const used = new Set(entries.map(([, s]) => s.sourceId));
          const [slots, sources] = await Promise.all([
            Promise.all(
              entries.map(async ([slotId, s]) => ({
                slotId,
                sourceId: s.sourceId,
                uploadedAtMs: s.uploadedAtMs,
                bytes: s.bytes,
                url: await signRead(s.path),
              })),
            ),
            Promise.all(
              (raw.parts[part.id]?.sources ?? [])
                .filter((src) => used.has(src.id))
                .map(async (src) => ({ id: src.id, name: src.name, thumbUrl: await signRead(src.thumbPath) })),
            ),
          ]);
          return {
            partId: part.id,
            state: derivePartState(now, session, part, attempt),
            startedAtMs: attempt?.startedAtMs ?? null,
            deadlineMs: attempt?.deadlineMs ?? null,
            finishedAtMs: attempt?.finishedAtMs ?? null,
            reopenedAtMs: attempt?.reopenedAtMs ?? null,
            slots,
            sources,
          };
        }),
      );
      return {
        sessionId: p.sessionId,
        label: raw.label,
        moduleId: raw.moduleId,
        addedAtMs: p.addedAtMs,
        revokedAtMs: p.revokedAtMs,
        closesAtMs: session.closesAtMs,
        parts,
        createdAtMs: raw.createdAtMs,
      };
    }),
  );

  return {
    nowMs: now,
    email: participants[0].email,
    name: await getCandidateName(emailHash),
    sessions: built
      .filter((x): x is AdminCandidateSession => x !== null)
      .sort((a, b) => b.createdAtMs - a.createdAtMs),
  };
}

// ─── Source images (admin) ───────────────────────────────────────────────────


/** Signs the pair of writes for one source image: the original and its small preview. */
export async function signSourceUpload(
  sessionId: string,
  partId: string,
  input: { contentType: string; size: number; previewSize: number },
): Promise<{ imageId: string; fullUrl: string; thumbUrl: string }> {
  const session = await loadSession(sessionId);
  const part = getPart(session.moduleId, partId);
  if (!part) throw new TrainingError('Not found', 404);

  const ext = extFor(input.contentType);
  if (!ext) throw new TrainingError(`Use ${IMAGE_LABEL} images`, 400);
  if (!(input.size > 0 && input.size <= MAX_SOURCE_BYTES)) throw new TrainingError('That image is too large', 400);
  if (!(input.previewSize > 0 && input.previewSize <= MAX_SOURCE_PREVIEW_BYTES)) {
    throw new TrainingError('The preview is too large', 400);
  }
  if ((session.parts[partId]?.sources.length ?? 0) >= MAX_SOURCES_PER_PART) {
    throw new TrainingError(`A part holds at most ${MAX_SOURCES_PER_PART} images`, 409);
  }

  const imageId = crypto.randomBytes(8).toString('hex');
  const base = `${STORAGE_ROOT}/sources/${sessionId}/${partId}/${imageId}`;
  const expires = Date.now() + SIGNED_WRITE_TTL_MS;
  const [fullUrl, thumbUrl] = await Promise.all([
    signWrite(`${base}.${ext}`, input.contentType, expires),
    signWrite(`${base}_thumb.webp`, 'image/webp', expires),
  ]);
  return { imageId, fullUrl, thumbUrl };
}

export async function commitSource(
  sessionId: string,
  partId: string,
  input: { imageId: string; name: string; contentType: string },
): Promise<void> {
  if (!/^[a-f0-9]{16}$/.test(input.imageId)) throw new TrainingError('Invalid image', 400);
  const ext = extFor(input.contentType);
  if (!ext) throw new TrainingError(`Use ${IMAGE_LABEL} images`, 400);

  const base = `${STORAGE_ROOT}/sources/${sessionId}/${partId}/${input.imageId}`;
  const path = `${base}.${ext}`;
  const thumbPath = `${base}_thumb.webp`;
  const bucket = adminStorage.bucket();

  let full;
  let thumb;
  try {
    [[full], [thumb]] = await Promise.all([bucket.file(path).getMetadata(), bucket.file(thumbPath).getMetadata()]);
  } catch {
    throw new TrainingError('That upload did not arrive. Try again.', 400);
  }
  const bytes = Number(full.size);
  const dropBoth = async (message: string): Promise<never> => {
    await Promise.all([
      bucket.file(path).delete({ ignoreNotFound: true }),
      bucket.file(thumbPath).delete({ ignoreNotFound: true }),
    ]).catch(() => {});
    throw new TrainingError(message, 400);
  };
  if (!(bytes > 0 && bytes <= MAX_SOURCE_BYTES) || full.contentType !== input.contentType) {
    return dropBoth('That image was not accepted');
  }
  if (!(Number(thumb.size) > 0 && Number(thumb.size) <= MAX_SOURCE_PREVIEW_BYTES) || thumb.contentType !== 'image/webp') {
    return dropBoth('The preview was not accepted');
  }
  if (!(await isDeclaredImage(path, input.contentType))) return dropBoth('That file is not a valid image');

  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || `image.${ext}`;
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new TrainingError('Not found', 404);
      const session = snap.data() as SessionDoc;
      const part = getPart(session.moduleId, partId);
      const cfg = session.parts[partId];
      if (!part || !cfg) throw new TrainingError('Not found', 404);
      if (cfg.sources.length >= MAX_SOURCES_PER_PART) {
        throw new TrainingError(`A part holds at most ${MAX_SOURCES_PER_PART} images`, 409);
      }
      tx.update(ref, {
        [`parts.${partId}.sources`]: [...cfg.sources, { id: input.imageId, name, path, thumbPath, bytes } satisfies SourceDoc],
      });
    });
  } catch (error) {
    await Promise.all([
      bucket.file(path).delete({ ignoreNotFound: true }),
      bucket.file(thumbPath).delete({ ignoreNotFound: true }),
    ]).catch(() => {});
    throw error;
  }
}

/**
 * Removes a source image — allowed at any time, including mid-test.
 *
 * Before the part opens nobody can have seen it, so it is deleted outright
 * (entry and files). From the moment it opens it is RETIRED instead: stamped
 * `removedAtMs`, offered to no one who starts (or is reopened) from now on,
 * but kept — in the list and in Storage — for attempts already running, which
 * may have it open in an editor, and for anyone who handed in an edit from it,
 * so their work still shows beside its source. Decided inside the transaction
 * on the open time, so it cannot race a Start.
 */
export async function removeSource(sessionId: string, partId: string, imageId: string): Promise<{ retired: boolean }> {
  const ref = adminDb.collection(SESSIONS_COLLECTION).doc(sessionId);
  const outcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TrainingError('Not found', 404);
    const session = snap.data() as SessionDoc;
    const cfg = session.parts[partId];
    if (!cfg) throw new TrainingError('Not found', 404);
    const target = cfg.sources.find((s) => s.id === imageId);
    if (!target || target.removedAtMs != null) return null;
    const now = Date.now();
    if (now >= cfg.opensAtMs) {
      tx.update(ref, {
        [`parts.${partId}.sources`]: cfg.sources.map((s) => (s.id === imageId ? { ...s, removedAtMs: now } : s)),
      });
      return { target, retired: true };
    }
    tx.update(ref, { [`parts.${partId}.sources`]: cfg.sources.filter((s) => s.id !== imageId) });
    return { target, retired: false };
  });
  if (outcome && !outcome.retired) {
    await Promise.all([
      adminStorage.bucket().file(outcome.target.path).delete({ ignoreNotFound: true }),
      adminStorage.bucket().file(outcome.target.thumbPath).delete({ ignoreNotFound: true }),
    ]).catch(() => {});
  }
  return { retired: outcome?.retired ?? false };
}
