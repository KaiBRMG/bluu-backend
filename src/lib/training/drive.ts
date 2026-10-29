import 'server-only';
import crypto from 'crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import {
  downloadBuffer,
  getFile,
  isNotFound,
  listChildren,
  resolvePath,
  type DriveItem,
} from '@/lib/google/drive';
import {
  DATASET_IDS,
  IMAGE_TYPES,
  MATERIAL_THUMB_PX,
  MAX_MATERIALS_PER_FOLDER,
  MAX_MATERIAL_BYTES,
  datasetKey,
  getModule,
  materialKeysFor,
  sourceCodeFromName,
  type DatasetId,
  type TestDef,
  type TrainingModuleDef,
} from '@/lib/training/modules';
import { TrainingError } from '@/lib/training/errors';
import type { MaterialCheck, MaterialFolderCheck, SyncPlan, SyncTodo } from '@/lib/training/types';
import { requireModule, requireTest as requireModuleTest } from '@/lib/training/model';
import { STORAGE_ROOT, extFor, sniffBytes } from '@/lib/training/storage';

/**
 * Training's side of Google Drive: where the materials live, and the sync that
 * copies them into Storage. The Drive client itself is `lib/google/drive.ts`.
 *
 *   Training/{driveFolder}/Datasets/{ADAM,COLE,JACKSON,JOE}
 *   Training/{driveFolder}/Source Media/T1 … T7        (T6: three subfolders)
 *   Training/{driveFolder}/Submissions/…               (the mirror — a later step)
 *
 * Drive is the source of truth for MATERIALS, but a candidate is never served
 * from it: Open copies each file into Storage and a candidate reads signed
 * Storage URLs. That keeps Drive's per-minute quota out of the candidate path and
 * means a file edited in Drive mid-test cannot change under someone's hands.
 *
 * THE MANIFEST. `training-materials/{moduleId}_{key}` records, per Drive file, the
 * checksum it was copied at and where it went. Open diffs the folder against it
 * and copies only what is new or changed — no difference, no refetch. Datasets
 * are keyed by identity, not test: T1 needs JOE, most tests need all four, T7 none,
 * so opening T2 after T1 re-lists JOE but copies nothing.
 *
 * THE COPY IS DRIVEN BY THE CLIENT, ONE FILE PER CALL. About 120 files is far too
 * many for one invocation, so `planSync` writes the to-do list into the manifest
 * (`pending`) and `syncFile` does exactly one entry of it. `syncFile` refuses any
 * Drive id that is not pending: an admin route must not become a way to make the
 * server fetch arbitrary Drive files.
 */

const MATERIALS = 'training-materials';
/** Top-level folder for everything Training puts in the shared drive. */
export const TRAINING_DRIVE_ROOT = 'Training';

// ─── Stored shape ────────────────────────────────────────────────────────────

interface ManifestFile {
  name: string;
  md5: string;
  mimeType: string;
  bytes: number;
  modifiedTime: string | null;
  path: string;
  thumbPath: string;
  width: number;
  height: number;
  syncedAtMs: number;
}

interface ManifestDoc {
  moduleId: string;
  key: string;
  /** The Drive folder, resolved by name once and kept — names are never searched again. */
  driveFolderId: string;
  files: Record<string, ManifestFile>;
  /** Drive ids planned but not yet copied. Empty and `syncedAtMs` set = complete. */
  pending: string[];
  syncedAtMs: number | null;
  planStartedAtMs: number;
}

const manifestRef = (moduleId: string, key: string) => adminDb.collection(MATERIALS).doc(`${moduleId}_${key}`);

// ─── Where a manifest key lives ──────────────────────────────────────────────

interface Location {
  /** Folder path under the shared drive's root. */
  path: string[];
  /** Where copies go in Storage. */
  storageDir: string;
  /** Short, for messages: "JOE dataset", "T1 source images". */
  label: string;
}

function locate(mod: TrainingModuleDef, key: string): Location | null {
  const base = [TRAINING_DRIVE_ROOT, mod.driveFolder];
  const dataset = DATASET_IDS.find((id) => datasetKey(id) === key);
  if (dataset) {
    return {
      path: [...base, 'Datasets', dataset],
      storageDir: `${STORAGE_ROOT}/materials/${mod.id}/datasets/${dataset}`,
      label: `${dataset} dataset`,
    };
  }
  const source = mod.tests.flatMap((t) => t.sources.map((s) => ({ s, t }))).find((x) => x.s.id === key);
  if (source) {
    return {
      path: [...base, 'Source Media', ...source.s.folder.split('/')],
      storageDir: `${STORAGE_ROOT}/materials/${mod.id}/sources/${key}`,
      label: `${source.s.folder.replace('/', ' / ')} source images`,
    };
  }
  return null;
}

const requireTest = (moduleId: string, testId: string): { mod: TrainingModuleDef; test: TestDef } => ({
  mod: requireModule(moduleId),
  test: requireModuleTest(moduleId, testId),
});

const isImage = (f: DriveItem) => f.mimeType in IMAGE_TYPES;

// ─── Diff ────────────────────────────────────────────────────────────────────

export interface MaterialDiff {
  key: string;
  label: string;
  /** The folder as an admin would find it in Drive. */
  folder: string;
  driveFolderId: string;
  added: DriveItem[];
  changed: DriveItem[];
  removed: { driveId: string; name: string }[];
  unchanged: number;
  /** Not copied, and why — wrong type, no checksum, too big. */
  skipped: { name: string; reason: string }[];
  /** The image files Drive holds now, for the coverage check. */
  present: { name: string }[];
}

/** Resolve the key's Drive folder: the cached id first, by name only if that is gone. */
async function folderId(loc: Location, cached?: string): Promise<string> {
  if (cached) {
    try {
      await getFile(cached); // a files.get 404s on a deleted folder; a files.list would just come back empty
      return cached;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  const id = await resolvePath(loc.path);
  if (!id) throw new TrainingError(`“${loc.path.join(' / ')}” was not found in Google Drive.`, 409);
  return id;
}

async function diffOne(mod: TrainingModuleDef, key: string): Promise<{ diff: MaterialDiff; manifest: ManifestDoc | null }> {
  const loc = locate(mod, key);
  if (!loc) throw new TrainingError(`Unknown materials “${key}”`, 500);

  const snap = await manifestRef(mod.id, key).get();
  const manifest = snap.exists ? (snap.data() as ManifestDoc) : null;
  const driveFolderId = await folderId(loc, manifest?.driveFolderId);

  const items = await listChildren(driveFolderId, 'files');
  const skipped: MaterialDiff['skipped'] = [];
  const usable: DriveItem[] = [];
  for (const f of items) {
    if (!isImage(f)) skipped.push({ name: f.name, reason: 'Not a JPG, PNG or WebP image' });
    else if (!f.md5Checksum) skipped.push({ name: f.name, reason: 'Drive gave no checksum' });
    else if ((f.size ?? 0) > MAX_MATERIAL_BYTES) skipped.push({ name: f.name, reason: 'Larger than 25 MB' });
    else usable.push(f);
  }
  if (usable.length > MAX_MATERIALS_PER_FOLDER) {
    throw new TrainingError(`${loc.label}: ${usable.length} images is more than the ${MAX_MATERIALS_PER_FOLDER} one folder may hold.`, 409);
  }

  const known = manifest?.files ?? {};
  const pending = new Set(manifest?.pending ?? []);
  const added: DriveItem[] = [];
  const changed: DriveItem[] = [];
  let unchanged = 0;
  for (const f of usable) {
    const have = known[f.id];
    // Still pending counts as not yet copied, so an abandoned prepare resumes.
    if (!have || pending.has(f.id)) added.push(f);
    else if (have.md5 !== f.md5Checksum) changed.push(f);
    else unchanged++;
  }
  const liveIds = new Set(usable.map((f) => f.id));
  const removed = Object.entries(known)
    .filter(([id]) => !liveIds.has(id))
    .map(([driveId, f]) => ({ driveId, name: f.name }));

  return {
    manifest,
    diff: {
      key,
      label: loc.label,
      folder: loc.path.slice(2).join(' / '),
      driveFolderId,
      added,
      changed,
      removed,
      unchanged,
      skipped,
      present: usable.map((f) => ({ name: f.name })),
    },
  };
}

// ─── Coverage: does the folder hold what the test needs? ─────────────────────

/**
 * What a test needs from its source folders, judged against file NAMES so the
 * same rule runs on Drive's live listing (Check Drive) and on the manifest
 * (the Open gate). Returns plain-language problems; empty means fine.
 */
export function coverageProblems(test: TestDef, namesBySource: Record<string, string[]>): string[] {
  const problems: string[] = [];
  if (test.kind === 'edit') {
    const names = namesBySource[test.sources[0].id] ?? [];
    const codes = new Map<string, number>();
    for (const n of names) {
      const c = sourceCodeFromName(n);
      if (c) codes.set(c, (codes.get(c) ?? 0) + 1);
    }
    for (const slot of test.slots) {
      if (!codes.has(slot.code!)) problems.push(`No source image for ${slot.code} in ${test.id}.`);
    }
    for (const [code, n] of codes) {
      if (n > 1) problems.push(`${test.id} has ${n} source images numbered ${code}.`);
    }
  } else if (test.kind === 'generate') {
    for (const src of test.sources) {
      if ((namesBySource[src.id] ?? []).length === 0) problems.push(`No images in “${src.folder}”.`);
    }
  } else if (test.sequence) {
    const n = (namesBySource[test.sources[0].id] ?? []).length;
    if (n !== test.sequence.count) problems.push(`${test.id} needs ${test.sequence.count} images; Drive holds ${n}.`);
  }
  for (const id of test.datasets) {
    if ((namesBySource[datasetKey(id)] ?? []).length === 0) problems.push(`The ${id} dataset is empty.`);
  }
  return problems;
}

export async function checkDrive(moduleId: string, testId: string): Promise<MaterialCheck> {
  const { mod, test } = requireTest(moduleId, testId);
  const namesBySource: Record<string, string[]> = {};
  const folders: MaterialFolderCheck[] = [];
  const problems: string[] = [...(test.pending ?? [])];
  let upToDate = true;

  for (const key of materialKeysFor(test)) {
    let diff: MaterialDiff;
    try {
      diff = (await diffOne(mod, key)).diff;
    } catch (err) {
      if (err instanceof TrainingError) {
        problems.push(err.message);
        upToDate = false;
        continue;
      }
      throw err;
    }
    namesBySource[key] = diff.present.map((p) => p.name);
    if (diff.added.length || diff.changed.length || diff.removed.length) upToDate = false;
    folders.push({
      key: diff.key,
      label: diff.label,
      folder: diff.folder,
      unchanged: diff.unchanged,
      skipped: diff.skipped,
      added: diff.added.map((f) => f.name),
      changed: diff.changed.map((f) => f.name),
      removed: diff.removed.map((f) => f.name),
    });
  }
  problems.push(...coverageProblems(test, namesBySource));
  return { testId, upToDate: upToDate && problems.length === 0, ok: problems.length === 0, problems, folders };
}

// ─── Plan + copy ─────────────────────────────────────────────────────────────

async function deleteQuietly(paths: string[]) {
  const bucket = adminStorage.bucket();
  await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => undefined)));
}

/**
 * Diff every manifest the test needs, delete what Drive dropped, write the to-do
 * list into each manifest and return it. Idempotent: running it again after an
 * abandoned prepare re-plans only what is still outstanding.
 */
export async function planSync(moduleId: string, testId: string): Promise<SyncPlan> {
  const { mod, test } = requireTest(moduleId, testId);
  if (test.pending?.length) throw new TrainingError(`${test.id} cannot be opened yet: ${test.pending[0]}`, 409);

  const todo: SyncTodo[] = [];
  let removedCount = 0;
  let unchanged = 0;
  const now = Date.now();

  for (const key of materialKeysFor(test)) {
    const { diff, manifest } = await diffOne(mod, key);

    const dropped = diff.removed.flatMap((r) => {
      const f = manifest!.files[r.driveId];
      return [f.path, f.thumbPath];
    });
    await deleteQuietly(dropped);
    removedCount += diff.removed.length;
    unchanged += diff.unchanged;

    const outstanding = [...diff.added, ...diff.changed];
    const files = { ...(manifest?.files ?? {}) };
    for (const r of diff.removed) delete files[r.driveId];

    const doc: ManifestDoc = {
      moduleId: mod.id,
      key,
      driveFolderId: diff.driveFolderId,
      files,
      pending: outstanding.map((f) => f.id),
      syncedAtMs: outstanding.length === 0 ? now : null,
      planStartedAtMs: now,
    };
    const untouched =
      manifest && manifest.syncedAtMs != null && outstanding.length === 0 && diff.removed.length === 0 && manifest.driveFolderId === diff.driveFolderId;
    if (!untouched) await manifestRef(mod.id, key).set(doc);
    for (const f of outstanding) todo.push({ key, driveId: f.id, name: f.name });
  }
  return { todo, removed: removedCount, unchanged };
}

/**
 * Copy exactly one planned file from Drive into Storage, make its thumbnail, and
 * record it. Returns how many are still outstanding in that manifest.
 */
export async function syncFile(moduleId: string, key: string, driveId: string): Promise<{ remaining: number }> {
  const mod = getModule(moduleId);
  const loc = mod && locate(mod, key);
  if (!mod || !loc) throw new TrainingError('Unknown materials', 404);

  const ref = manifestRef(mod.id, key);
  const snap = await ref.get();
  const manifest = snap.exists ? (snap.data() as ManifestDoc) : null;
  if (!manifest || !manifest.pending.includes(driveId)) {
    // Not planned (or already done by a retry) — nothing to do, and never fetch an unplanned id.
    return { remaining: manifest?.pending.length ?? 0 };
  }

  const meta = await getFile(driveId);
  if (!isImage(meta) || !meta.md5Checksum || (meta.size ?? 0) > MAX_MATERIAL_BYTES) {
    throw new TrainingError(`“${meta.name}” is not a usable image`, 422);
  }
  const bytes = await downloadBuffer(driveId);
  if (crypto.createHash('md5').update(bytes).digest('hex') !== meta.md5Checksum) {
    throw new TrainingError(`“${meta.name}” did not download intact — try again`, 502);
  }
  // Trust the bytes, not the label Drive gave: the copy is stored under the sniffed type.
  const sniffed = sniffBytes(bytes);
  const mimeType = sniffed && Object.keys(IMAGE_TYPES).find((m) => (IMAGE_TYPES as Record<string, { sniff: string }>)[m].sniff === sniffed);
  if (!mimeType) throw new TrainingError(`“${meta.name}” is not a JPG, PNG or WebP image`, 422);

  // `sharp` is large and native; every candidate route imports this module, so load it only here.
  const sharp = (await import('sharp')).default;
  const info = await sharp(bytes, { failOn: 'none' }).metadata();
  const swap = (info.orientation ?? 1) >= 5; // EXIF-rotated: the displayed size is the other way round
  const width = (swap ? info.height : info.width) ?? 0;
  const height = (swap ? info.width : info.height) ?? 0;
  const thumb = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize({ width: MATERIAL_THUMB_PX, height: MATERIAL_THUMB_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  // The checksum is in the name, so a changed file is a NEW path: a browser or
  // signed-URL cache can never show the old bytes under the same address.
  const stem = `${loc.storageDir}/${driveId}-${meta.md5Checksum.slice(0, 10)}`;
  const path = `${stem}.${extFor(mimeType)}`;
  const thumbPath = `${stem}_thumb.webp`;
  const bucket = adminStorage.bucket();
  const cacheControl = 'private, max-age=31536000, immutable';
  await Promise.all([
    bucket.file(path).save(bytes, { contentType: mimeType, resumable: false, metadata: { cacheControl } }),
    bucket.file(thumbPath).save(thumb, { contentType: 'image/webp', resumable: false, metadata: { cacheControl } }),
  ]);

  const entry: ManifestFile = {
    name: meta.name,
    md5: meta.md5Checksum,
    mimeType,
    bytes: bytes.length,
    modifiedTime: meta.modifiedTime ?? null,
    path,
    thumbPath,
    width,
    height,
    syncedAtMs: Date.now(),
  };

  let replaced: ManifestFile | undefined;
  const remaining = await adminDb.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const doc = cur.data() as ManifestDoc;
    replaced = doc.files[driveId];
    const pending = doc.pending.filter((id) => id !== driveId);
    tx.update(ref, new FieldPath('files', driveId), entry, 'pending', pending, 'syncedAtMs', pending.length === 0 ? Date.now() : null);
    return pending.length;
  });
  // The previous copy of a changed file, now unreferenced.
  if (replaced && replaced.path !== path) await deleteQuietly([replaced.path, replaced.thumbPath]);
  return { remaining };
}

// ─── The Open gate ───────────────────────────────────────────────────────────

/**
 * Whether every manifest the test needs is complete and covers what the test
 * asks for. Reads Firestore only (never Drive): this is what the Open
 * transaction enforces on the SERVER, so "the test opens only once its files are
 * fetched" holds whatever the page does. Returns the problems; empty = ready.
 */
export async function materialsProblems(moduleId: string, testId: string): Promise<string[]> {
  const { mod, test } = requireTest(moduleId, testId);
  if (test.pending?.length) return test.pending;
  const keys = materialKeysFor(test);
  const snaps = await adminDb.getAll(...keys.map((k) => manifestRef(mod.id, k)));
  const problems: string[] = [];
  const namesBySource: Record<string, string[]> = {};
  snaps.forEach((s, i) => {
    const key = keys[i];
    const m = s.exists ? (s.data() as ManifestDoc) : null;
    if (!m || m.pending.length > 0 || m.syncedAtMs == null) {
      problems.push(`${locate(mod, key)?.label ?? key} has not been fetched from Drive yet.`);
      return;
    }
    namesBySource[key] = Object.values(m.files).map((f) => f.name);
  });
  if (problems.length === 0) problems.push(...coverageProblems(test, namesBySource));
  return problems;
}

/** A copied material, as the readers see it. */
export interface MaterialFile {
  driveId: string;
  name: string;
  path: string;
  thumbPath: string;
  width: number;
  height: number;
}

/** One manifest's files in name order (numeric-aware, so `Adam2` precedes `Adam10`). Empty if never synced. */
export async function readMaterials(moduleId: string, key: string): Promise<MaterialFile[]> {
  const s = await manifestRef(moduleId, key).get();
  return s.exists ? sortedFiles(s.data() as ManifestDoc) : [];
}

const sortedFiles = (m: ManifestDoc): MaterialFile[] =>
  Object.entries(m.files)
    .map(([driveId, f]) => ({ driveId, name: f.name, path: f.path, thumbPath: f.thumbPath, width: f.width, height: f.height }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/**
 * The source images of a test, matched to its slots. `edit` tests pair one source
 * to each slot by the number in the file name; `generate` keeps each tier's group;
 * a `sequence` test's order is the file order. One batched Firestore read.
 */
export async function testSources(
  moduleId: string,
  test: TestDef,
): Promise<(MaterialFile & { slotId?: string; group?: string })[]> {
  const snaps = await adminDb.getAll(...test.sources.map((s) => manifestRef(moduleId, s.id)));
  const out: (MaterialFile & { slotId?: string; group?: string })[] = [];
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const src = test.sources[i];
    for (const f of sortedFiles(snap.data() as ManifestDoc)) {
      if (test.kind === 'edit') {
        const code = sourceCodeFromName(f.name);
        const slot = test.slots.find((s) => s.code === code);
        if (slot) out.push({ ...f, slotId: slot.id });
      } else {
        out.push({ ...f, ...(src.label ? { group: src.label } : {}) });
      }
    }
  });
  return out;
}

/** One dataset's images in name order, for the dataset modal. */
export const readDataset = (moduleId: string, id: DatasetId) => readMaterials(moduleId, datasetKey(id));
