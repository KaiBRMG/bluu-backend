import 'server-only';
import crypto from 'crypto';
import { Readable } from 'stream';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { extFor } from '@/lib/training/storage';
import { createFolder, findFolder, resolvePath, trashFile, uploadStream } from '@/lib/google/drive';
import { TRAINING_DRIVE_ROOT } from '@/lib/training/drive';
import { DATASETS, WORK_CONTENT_TYPE, getModule, getTest, type DatasetId, type SlotDef, type TestDef } from '@/lib/training/modules';
import { cleanFileName } from '@/lib/training/fileName';
import { PARTICIPANTS_COLLECTION, clockEndMs, participantRef, readModuleDoc, moduleRef, type AttemptDoc, type ModuleDoc, type ParticipantDoc, type SlotDoc, type WorkingFileDoc } from '@/lib/training/model';
import { UPLOAD_GRACE_MS, WORKING_GRACE_MS } from '@/lib/training/modules';

/**
 * Storage → Drive: every file a candidate hands in is copied into the shared
 * drive beside the materials, so an admin finds each result in a folder named
 * for the person, with a name the SERVER chose (`T1 - 001.png`), not whatever the
 * candidate called it.
 *
 *   Training/{driveFolder}/Submissions/<Candidate name>/T{n}_<attemptId>/
 *       Final Images/   T1 - 001.png …
 *       Working Files/  …as uploaded
 *       Task record.txt   (T7: Answers.txt)
 *
 * Storage is the record; Drive is a copy. A failed copy never fails the upload —
 * it is marked `failed`, shown on the roster with a Retry, and retried by the
 * daily sweep (`sweepMirrors`). Streaming Storage → Drive is function egress, not
 * CDN↔origin traffic, so it is not the Fast Origin Transfer bill; it does use
 * function time, which is why it runs in `after()` (rule 9i).
 */

/** A copy that has been pending or failed this long is retried by the sweep. */
const RETRY_AFTER_MS = 10 * 60_000;
const LEASE_MS = 60_000;
const MAX_LEASE_WAITS = 20;

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type MirrorTarget = { kind: 'slot'; slotId: string } | { kind: 'work'; id: string };

interface Folders {
  root: string;
  final: string;
  work: string;
}

/** The Drive name of a final image: the slot's stem, plus the identity on T4 where the candidate chose it. */
export function driveNameForSlot(slot: SlotDef, contentType: string, identity?: DatasetId): string {
  const who = slot.pickIdentity && identity ? ` - ${DATASETS[identity].label}` : '';
  return `${slot.stem}${who}.${extFor(contentType)}`;
}

// ─── Folders, created under a lease ──────────────────────────────────────────

/**
 * The candidate's folder under `Submissions/`, created once and remembered by id
 * — renaming it in Drive afterwards is harmless. Drive allows duplicate names, so
 * a same-named candidate gets a short hash suffix instead of sharing a folder.
 */
async function candidateFolder(moduleId: string, emailHash: string, driveFolder: string): Promise<string> {
  const cRef = adminDb.collection('training-candidates').doc(emailHash);
  const cand = (await cRef.get()).data();
  const known = (cand?.driveFolders as Record<string, string> | undefined)?.[moduleId];
  if (known) return known;

  const submissions = await resolvePath([TRAINING_DRIVE_ROOT, driveFolder, 'Submissions'], { create: true });
  const name = cleanFileName(typeof cand?.name === 'string' && cand.name ? cand.name : `Candidate ${emailHash.slice(0, 8)}`);
  const taken = await findFolder(submissions!, name);
  const created = await createFolder(submissions!, taken ? `${name} (${emailHash.slice(0, 4)})` : name);
  await cRef.set({ driveFolders: { [moduleId]: created.id } }, { merge: true });
  return created.id;
}

/**
 * The attempt's three folders. Two finalizes landing together must not each
 * create a `T1_x`, so creation is done by whoever wins a short lease on the
 * attempt; the loser waits and then reads the ids the winner wrote.
 */
async function ensureFolders(moduleId: string, emailHash: string, testId: string, known?: AttemptDoc): Promise<Folders> {
  if (known?.driveFolderId && known.driveFinalFolderId && known.driveWorkFolderId) {
    return { root: known.driveFolderId, final: known.driveFinalFolderId, work: known.driveWorkFolderId };
  }
  const pRef = participantRef(moduleId, emailHash);
  const def = getModule(moduleId);
  if (!def) throw new Error('Unknown module');

  for (let i = 0; i < MAX_LEASE_WAITS; i++) {
    const leaseId = crypto.randomBytes(6).toString('hex');
    const outcome = await adminDb.runTransaction(async (tx) => {
      const a = ((await tx.get(pRef)).data() as ParticipantDoc | undefined)?.attempts?.[testId];
      if (!a) throw new Error('No attempt to mirror');
      if (a.driveFolderId && a.driveFinalFolderId && a.driveWorkFolderId) {
        return { state: 'done' as const, folders: { root: a.driveFolderId, final: a.driveFinalFolderId, work: a.driveWorkFolderId } };
      }
      if (a.driveLease && a.driveLease.untilMs > Date.now()) return { state: 'busy' as const };
      tx.update(pRef, { [`attempts.${testId}.driveLease`]: { id: leaseId, untilMs: Date.now() + LEASE_MS } });
      return { state: 'mine' as const, attemptId: a.attemptId };
    });

    if (outcome.state === 'done') return outcome.folders;
    if (outcome.state === 'busy') {
      await sleep(1500);
      continue;
    }
    try {
      const parent = await candidateFolder(moduleId, emailHash, def.driveFolder);
      const root = await createFolder(parent, `${testId}_${outcome.attemptId}`);
      const [final, work] = await Promise.all([createFolder(root.id, 'Final Images'), createFolder(root.id, 'Working Files')]);
      await pRef.update({
        [`attempts.${testId}.driveFolderId`]: root.id,
        [`attempts.${testId}.driveFolderUrl`]: folderUrl(root.id),
        [`attempts.${testId}.driveFinalFolderId`]: final.id,
        [`attempts.${testId}.driveWorkFolderId`]: work.id,
        [`attempts.${testId}.driveLease`]: FieldValue.delete(),
      });
      return { root: root.id, final: final.id, work: work.id };
    } catch (err) {
      await pRef.update({ [`attempts.${testId}.driveLease`]: FieldValue.delete() }).catch(() => {});
      throw err;
    }
  }
  throw new Error('Timed out waiting for the Drive folders');
}

// ─── Bookkeeping ─────────────────────────────────────────────────────────────

const unsynced = (a: AttemptDoc) =>
  [...Object.values(a.slots), ...Object.values(a.workingFiles ?? {})].some((f) => f.driveState !== 'synced');

const hashOf = (body: string) => crypto.createHash('sha1').update(body).digest('hex');

/**
 * The record has text Drive does not hold yet. A T7 attempt has no files at all, and a text-only
 * attempt may never upload one, so without this the sweep would never see either of them.
 */
function recordStale(test: TestDef | null, a: AttemptDoc): boolean {
  const record = test && recordOf(test, a);
  return !!record && hashOf(record.body) !== a.driveTextHash;
}

/**
 * Keeps `mirrorPending` true exactly while something has not reached Drive: a file that is not
 * `synced`, or a record whose text Drive does not hold. (A running attempt's record is "stale"
 * until it ends and is written, so the flag stays up through the test — the sweep only acts on
 * attempts that have ended.)
 */
async function refreshFlag(pRef: FirebaseFirestore.DocumentReference): Promise<void> {
  const p = (await pRef.get()).data() as ParticipantDoc | undefined;
  if (!p) return;
  const pending = Object.entries(p.attempts ?? {}).some(([testId, a]) => unsynced(a) || recordStale(getTest(p.moduleId, testId), a));
  if (!!p.mirrorPending !== pending) await pRef.update({ mirrorPending: pending });
}

// ─── Copying ─────────────────────────────────────────────────────────────────

/**
 * Copies one stored file to Drive. Idempotent: a file already `synced` is left
 * alone. The result is recorded only if the slot still holds the object that was
 * copied — a candidate who replaced it meanwhile must not get the old file
 * recorded as the new one's copy (the stray Drive file is trashed).
 */
export async function mirrorFile(moduleId: string, emailHash: string, testId: string, target: MirrorTarget): Promise<void> {
  const test = getTest(moduleId, testId);
  if (!test) return;
  const pRef = participantRef(moduleId, emailHash);
  const read = async () => ((await pRef.get()).data() as ParticipantDoc | undefined)?.attempts?.[testId];

  const attempt = await read();
  if (!attempt) return;
  const key = target.kind === 'slot' ? `slots.${target.slotId}` : `workingFiles.${target.id}`;
  const entry = target.kind === 'slot' ? attempt.slots[target.slotId] : attempt.workingFiles?.[target.id];
  if (!entry || entry.driveState === 'synced') return;

  const slot = target.kind === 'slot' ? test.slots.find((s) => s.id === target.slotId) : null;
  const name =
    target.kind === 'slot'
      ? slot && driveNameForSlot(slot, (entry as SlotDoc).contentType, (entry as SlotDoc).identity)
      : (entry as WorkingFileDoc).name; // already cleaned when the upload was signed
  if (!name) return;

  try {
    const folders = await ensureFolders(moduleId, emailHash, testId, attempt);
    const file = adminStorage.bucket().file(entry.path);
    const uploaded = await uploadStream({
      parentId: target.kind === 'slot' ? folders.final : folders.work,
      name,
      mimeType: target.kind === 'slot' ? (entry as SlotDoc).contentType : WORK_CONTENT_TYPE,
      size: entry.bytes,
      body: file.createReadStream(),
    });

    const stale = await adminDb.runTransaction(async (tx) => {
      const cur = ((await tx.get(pRef)).data() as ParticipantDoc | undefined)?.attempts?.[testId];
      const now = target.kind === 'slot' ? cur?.slots[target.slotId] : cur?.workingFiles?.[target.id];
      if (!now || now.path !== entry.path) return true; // replaced while it was copying
      tx.update(pRef, {
        [`attempts.${testId}.${key}.driveFileId`]: uploaded.id,
        [`attempts.${testId}.${key}.driveState`]: 'synced',
        [`attempts.${testId}.${key}.driveFailedAtMs`]: FieldValue.delete(),
      });
      return false;
    });
    if (stale) await trashFile(uploaded.id);
  } catch (err) {
    console.error(`[training/mirror] ${moduleId}/${testId} ${key}`, err);
    // Only if the entry is still the one that failed.
    await pRef
      .update({
        [`attempts.${testId}.${key}.driveState`]: 'failed',
        [`attempts.${testId}.${key}.driveFailedAtMs`]: Date.now(),
      })
      .catch(() => {});
  }
  await refreshFlag(pRef);
}

/** The text a record file holds: T7's answers in order, or the candidate's task record. */
function recordOf(test: TestDef, attempt: AttemptDoc): { name: string; body: string } | null {
  if (test.sequence) {
    const lines = Array.from({ length: test.sequence.count }, (_, i) => {
      const a = attempt.answers?.[String(i)];
      return `Image ${i + 1}: ${a ? a.text || '(blank)' : 'No answer'}`;
    });
    return attempt.answers && Object.keys(attempt.answers).length ? { name: 'Answers.txt', body: lines.join('\n\n') } : null;
  }
  return attempt.text?.trim() ? { name: 'Task record.txt', body: attempt.text } : null;
}

/**
 * Copies the task record (or T7's answers) as a text file. Skips when Drive
 * already holds this exact text; otherwise the previous copy is trashed and a new
 * one written, which avoids the update-with-media call for a few KB.
 */
export async function mirrorRecord(moduleId: string, emailHash: string, testId: string): Promise<void> {
  const test = getTest(moduleId, testId);
  if (!test) return;
  const pRef = participantRef(moduleId, emailHash);
  const attempt = ((await pRef.get()).data() as ParticipantDoc | undefined)?.attempts?.[testId];
  if (!attempt) return;
  const record = recordOf(test, attempt);
  if (!record) return;
  const hash = hashOf(record.body);
  if (attempt.driveTextHash === hash) return;

  try {
    const folders = await ensureFolders(moduleId, emailHash, testId, attempt);
    const data = Buffer.from(record.body, 'utf8');
    const file = await uploadStream({
      parentId: folders.root,
      name: record.name,
      mimeType: 'text/plain',
      size: data.length,
      body: Readable.from(data),
    });
    await pRef.update({
      [`attempts.${testId}.driveTextFileId`]: file.id,
      [`attempts.${testId}.driveTextHash`]: hash,
    });
    if (attempt.driveTextFileId) await trashFile(attempt.driveTextFileId);
  } catch (err) {
    console.error(`[training/mirror] record ${moduleId}/${testId}`, err);
  }
  await refreshFlag(pRef);
}

/** Everything of one attempt that has not reached Drive: files, then the record. */
export async function mirrorAttempt(moduleId: string, emailHash: string, testId: string): Promise<number> {
  const attempt = ((await participantRef(moduleId, emailHash).get()).data() as ParticipantDoc | undefined)?.attempts?.[testId];
  if (!attempt) return 0;
  let copied = 0;
  for (const slotId of Object.keys(attempt.slots)) {
    if (attempt.slots[slotId].driveState !== 'synced') {
      await mirrorFile(moduleId, emailHash, testId, { kind: 'slot', slotId });
      copied++;
    }
  }
  for (const id of Object.keys(attempt.workingFiles ?? {})) {
    if (attempt.workingFiles[id].driveState !== 'synced') {
      await mirrorFile(moduleId, emailHash, testId, { kind: 'work', id });
      copied++;
    }
  }
  await mirrorRecord(moduleId, emailHash, testId);
  return copied;
}

/** A replaced final image's old copy goes to the trash so Drive never holds two answers for one slot. */
export const trashDriveCopy = (driveFileId: string | undefined) => (driveFileId ? trashFile(driveFileId) : Promise.resolve());

// ─── The sweep ───────────────────────────────────────────────────────────────

const SWEEP_LIMIT = 40;

/**
 * Retries every copy that is still pending or failed after `RETRY_AFTER_MS`, and
 * writes the record of any attempt that has ended. Reads one flagged query, not a
 * scan of every participant. Bounded per run: a backlog finishes across days
 * rather than timing out half-done.
 */
export async function sweepMirrors(): Promise<{ attempts: number }> {
  const snap = await adminDb.collection(PARTICIPANTS_COLLECTION).where('mirrorPending', '==', true).limit(SWEEP_LIMIT).get();
  const now = Date.now();
  let attempts = 0;
  const mods = new Map<string, ModuleDoc>(); // one read per distinct module, not per participant
  for (const doc of snap.docs) {
    const p = doc.data() as ParticipantDoc;
    let mod = mods.get(p.moduleId);
    if (!mod) mods.set(p.moduleId, (mod = readModuleDoc(await moduleRef(p.moduleId).get())));
    for (const [testId, a] of Object.entries(p.attempts ?? {})) {
      const files = [...Object.values(a.slots), ...Object.values(a.workingFiles ?? {})];
      const due = files.some((f) => f.driveState !== 'synced' && now - (f.driveFailedAtMs ?? f.uploadedAtMs) > RETRY_AFTER_MS);
      const ended = now > clockEndMs(a, mod) + Math.max(UPLOAD_GRACE_MS, WORKING_GRACE_MS);
      if (!due && !(ended && recordStale(getTest(p.moduleId, testId), a))) continue;
      attempts++;
      await mirrorAttempt(p.moduleId, p.emailHash, testId);
    }
    await refreshFlag(doc.ref);
  }
  return { attempts };
}
