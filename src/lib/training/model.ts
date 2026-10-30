import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { DatasetId, TestDef, TestId } from '@/lib/training/modules';
import { TrainingError } from '@/lib/training/errors';
import { getModule, getTest } from '@/lib/training/modules';
import type { MirrorState, TestState, TestStatus } from '@/lib/training/types';

/**
 * Training's Firestore documents and the rules that read them — shared by the
 * main service, the recording service and the Drive mirror. Admin-SDK-only
 * collections, no client rule (rule 10):
 *
 *   training-modules/{moduleId}                 the switch + which test is open
 *   training-participants/{moduleId}_{emailHash} one candidate on one module + their attempts
 *   training-candidates/{emailHash}             the person (name) — see trainingAuthService
 *   training-materials/{moduleId}_{key}         the Drive manifest — see lib/training/drive.ts
 *
 * THE CLOCK IS THE SERVER'S. `deadlineMs` is written once, at Start, in a
 * transaction; the browser only renders `deadline − (now + skew)`. A refresh, a
 * second tab and a wrong device clock cannot move it.
 */

export const MODULES_COLLECTION = 'training-modules';
export const PARTICIPANTS_COLLECTION = 'training-participants';

// ─── Stored shapes ───────────────────────────────────────────────────────────

export interface TestStateDoc {
  status: TestStatus;
  openedAtMs: number | null;
  closedAtMs: number | null;
  /** Bumped every time the test is opened, so a reader can tell a re-open from the first. */
  materialsVersion: number;
}

export interface ModuleDoc {
  isOn: boolean;
  switchedOnAtMs: number | null;
  /**
   * The last time the module was switched off. An attempt that was running
   * (started or reopened before it) ended there, even if the module is on again.
   */
  switchedOffAtMs: number | null;
  openTestId: TestId | null;
  tests: Partial<Record<TestId, TestStateDoc>>;
  /** People on the module, not removed. Kept here so the list needs no count query. */
  participantCount?: number;
}

/** Where a stored file stands with the Drive mirror. */
export interface DriveCopy {
  driveFileId?: string;
  driveState?: MirrorState;
  /** When the last attempt to copy it failed — for the retry sweep and the admin's marker. */
  driveFailedAtMs?: number;
}

export interface PendingDoc {
  kind: 'final' | 'work';
  /** `final` only. */
  slotId?: string;
  /** `work` only: the original name, sanitised, for display and the Drive name. */
  fileName?: string;
  path: string;
  contentType: string;
  issuedAtMs: number;
}

export interface SlotDoc extends DriveCopy {
  path: string;
  bytes: number;
  contentType: string;
  uploadedAtMs: number;
  /** The identity in force when it was uploaded (fixed, or the candidate's pick on T4). */
  identity?: DatasetId;
}

export interface WorkingFileDoc extends DriveCopy {
  name: string;
  path: string;
  bytes: number;
  uploadedAtMs: number;
}

export interface AnswerDoc {
  text: string;
  atMs: number;
}

export interface AttemptDoc {
  /** Short, names the Drive folder: `T1_k3f9x2`. */
  attemptId: string;
  startedAtMs: number;
  deadlineMs: number;
  finishedAtMs: number | null;
  /** Set when an admin ended this attempt (it also sets `finishedAtMs`). Cleared by a reopen. */
  endedByAdminAtMs?: number;
  reopenedAtMs?: number;
  /** Final-image uploads need a fresh recording segment. */
  recording?: boolean;
  /** The next segment sequence number to sign. Never reset — a reopen continues it. */
  segmentSeq?: number;
  recordingDeletedAtMs?: number;
  uploadAttempts: number;
  pending: Record<string, PendingDoc>;
  slots: Record<string, SlotDoc>;
  workingFiles: Record<string, WorkingFileDoc>;
  text: string;
  textUpdatedAtMs: number | null;
  /** T7 — keyed by the image's index in the sequence, as a string. */
  answers?: Record<string, AnswerDoc>;
  /**
   * T7 — how many images have been shown (1 at Start; Next adds one). Images below it can be seen and
   * answered again; the rest are never signed, so there is no looking ahead. Kept on a reopen.
   */
  revealed?: number;
  /** T4 — the identity chosen per slot. */
  datasetChoices?: Record<string, DatasetId>;
  /** The Drive folder holding this attempt's mirror, and its two subfolders. Created under a lease — see the mirror. */
  driveFolderId?: string;
  driveFolderUrl?: string;
  driveFinalFolderId?: string;
  driveWorkFolderId?: string;
  /** Held while one process creates the folders, so two concurrent finalizes do not each create a `T1_x`. */
  driveLease?: { id: string; untilMs: number };
  /** The Drive copy of the task record (or T7's answers), and the hash of what it holds. */
  driveTextFileId?: string;
  driveTextHash?: string;
}

export interface ScreenCheckDoc {
  /** When the last check still was verified. */
  atMs: number | null;
  path: string | null;
  /** The check signed but not yet confirmed. */
  pendingId: string | null;
  /** Checks ever signed for this test — the bound on a looping client. */
  count: number;
}

export interface ParticipantDoc {
  moduleId: string;
  emailHash: string;
  email: string;
  addedAtMs: number;
  revokedAtMs: number | null;
  /** The last reopen of any test, so a module switch-off before it does not outlive it. */
  reopenedAtMs?: number;
  /**
   * True while any file of any attempt has not reached the Drive mirror. The retry
   * sweep queries this one flag instead of scanning every participant's attempts.
   */
  mirrorPending?: boolean;
  /** Per test: the screen check that Start requires. Kept off `attempts`, whose keys mean "started". */
  screenChecks?: Record<string, ScreenCheckDoc>;
  attempts: Record<string, AttemptDoc>;
}

export const moduleRef = (moduleId: string) => adminDb.collection(MODULES_COLLECTION).doc(moduleId);
export const participantId = (moduleId: string, emailHash: string) => `${moduleId}_${emailHash}`;
export const participantRef = (moduleId: string, emailHash: string) =>
  adminDb.collection(PARTICIPANTS_COLLECTION).doc(participantId(moduleId, emailHash));

/** A module that has never been switched on has no document: it is off. */
export const OFF_MODULE: ModuleDoc = {
  isOn: false,
  switchedOnAtMs: null,
  switchedOffAtMs: null,
  openTestId: null,
  tests: {},
};

export const readModuleDoc = (snap: FirebaseFirestore.DocumentSnapshot): ModuleDoc =>
  snap.exists ? { ...OFF_MODULE, ...(snap.data() as ModuleDoc) } : OFF_MODULE;

// ─── The clock ───────────────────────────────────────────────────────────────

export const runFrom = (a: AttemptDoc) => a.reopenedAtMs ?? a.startedAtMs;

/**
 * When the attempt's CLOCK ends: its deadline, or the moment the module was
 * switched off if that came during this run. Ignores finishing early — an upload
 * already travelling when someone finishes still lands (it is the grace that
 * bounds it).
 */
export function clockEndMs(attempt: AttemptDoc, mod: ModuleDoc): number {
  const off = mod.switchedOffAtMs;
  return off != null && off > runFrom(attempt) ? Math.min(attempt.deadlineMs, off) : attempt.deadlineMs;
}

/** When the attempt stopped or stops: finished early, or the clock — whichever came first. */
export function attemptEndMs(attempt: AttemptDoc, mod: ModuleDoc): number {
  return attempt.finishedAtMs ?? clockEndMs(attempt, mod);
}

/** What a candidate reads when the team ended their test — said, not dressed up as "time is up". */
export const ENDED_BY_TEAM = 'The team has ended this test for you. Everything you uploaded is kept.';

/**
 * The refusal for work on an attempt that is not running. An attempt an admin ended is 410 with
 * code `attempt-ended`, so the candidate's room closes itself with the right words — the recorder
 * asks for upload slots every minute, so an idle room hears it within a minute too. Everything
 * else is the caller's own time-is-up message, 409.
 */
export function notRunning(attempt: AttemptDoc | undefined, timeUp: string): TrainingError {
  return attempt?.endedByAdminAtMs
    ? new TrainingError(ENDED_BY_TEAM, 410, 'attempt-ended')
    : new TrainingError(timeUp, 409);
}

export function isRunning(attempt: AttemptDoc | undefined, mod: ModuleDoc, now: number): attempt is AttemptDoc {
  return !!attempt && !attempt.finishedAtMs && now <= clockEndMs(attempt, mod);
}

/** A test is complete when every slot has a final image (T7 has none: its end is its clock). */
export function isComplete(test: TestDef, attempt: AttemptDoc): boolean {
  return test.slots.every((s) => attempt.slots[s.id]);
}

export function deriveTestState(
  now: number,
  mod: ModuleDoc,
  test: TestDef,
  attempt: AttemptDoc | undefined,
): TestState {
  if (attempt) {
    if (attempt.finishedAtMs) return 'submitted';
    if (now > clockEndMs(attempt, mod)) return isComplete(test, attempt) ? 'submitted' : 'timed-out';
    return 'in-progress';
  }
  const t = mod.tests[test.id];
  if (mod.isOn && mod.openTestId === test.id && t?.status === 'open') return 'open';
  return t?.closedAtMs != null && t.openedAtMs != null ? 'missed' : 'locked';
}

/** The worst mirror state among an attempt's files — failed beats pending beats synced. */
export function mirrorStateOf(attempt: AttemptDoc | undefined): MirrorState | null {
  if (!attempt) return null;
  const states = [...Object.values(attempt.slots), ...Object.values(attempt.workingFiles ?? {})].map(
    (f) => f.driveState ?? 'pending',
  );
  if (states.length === 0) return null;
  return states.includes('failed') ? 'failed' : states.includes('pending') ? 'pending' : 'synced';
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function requireTest(moduleId: string, testId: string): TestDef {
  const test = getTest(moduleId, testId);
  if (!test) throw new TrainingError('Not found', 404);
  return test;
}

export function requireModule(moduleId: string) {
  const mod = getModule(moduleId);
  if (!mod) throw new TrainingError('Not found', 404);
  return mod;
}

/**
 * One participation for a candidate's write: refuses a revoked person, a module
 * that is off and an unknown test. Everything a candidate does is checked
 * against THIS, so switching the module off or removing someone bites on the
 * very next request — the cookie is an identity, not an access.
 */
export function candidateContext(
  pSnap: FirebaseFirestore.DocumentSnapshot,
  mSnap: FirebaseFirestore.DocumentSnapshot,
  moduleId: string,
  testId: string,
) {
  const test = requireTest(moduleId, testId);
  if (!pSnap.exists) throw new TrainingError('Not found', 404);
  const participant = pSnap.data() as ParticipantDoc;
  if (participant.revokedAtMs != null) throw new TrainingError('Not found', 404);
  const mod = readModuleDoc(mSnap);
  if (!mod.isOn) throw new TrainingError('Training is not running right now', 410);
  return { participant, mod, test };
}

/** An emailHash as `emailHashFor` makes it: 32 hex characters. */
export const isEmailHash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);

/** A new short attempt id for the Drive folder name. Not a secret: it names a folder, it grants nothing. */
export function newAttemptId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}
