import 'server-only';
import type { drive_v3 } from 'googleapis';
import type { Readable } from 'stream';

/**
 * Google Drive, server-only — the generic client for the shared **Bluu-Backend**
 * drive. It knows nothing about any subsystem: Training is one top-level folder
 * in it and other subsystems add their own. Subsystem paths and policy live in
 * the subsystem (see `lib/training/drive.ts`).
 *
 * Auth is a service account (`GOOGLE_DRIVE_SERVICE_ACCOUNT`, the JSON) that is a
 * Manager of the shared drive, whose id is `GOOGLE_DRIVE_ROOT_ID`. A shared
 * drive's root folder id IS the drive id, so one variable serves both: it is the
 * parent of top-level folders and the `driveId` every list is scoped to.
 *
 * Shared drives need three things on every call, and forgetting one is a silent
 * "not found" rather than an error:
 *   - `supportsAllDrives: true` on every request;
 *   - on every list, `includeItemsFromAllDrives`, `corpora: 'drive'` and `driveId`;
 *   - listings that skip Google-native files (`application/vnd.google-apps.*`):
 *     they have no `md5Checksum`, no bytes, and cannot be downloaded.
 *
 * Drive quota is per-minute and per-user, not billed, but a burst trips it. Calls
 * are sequential by design — nothing here fans out, and nothing polls.
 */

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  /** Absent on folders and Google-native files. */
  md5Checksum?: string;
  modifiedTime?: string;
  size?: number;
}

const FILE_FIELDS = 'id,name,mimeType,md5Checksum,modifiedTime,size';

type JwtClient = InstanceType<(typeof import('googleapis'))['google']['auth']['JWT']>;
let cached: { drive: drive_v3.Drive; auth: JwtClient } | null = null;

export function driveRootId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_ID?.trim().replace(/^['"]|['"]$/g, '');
  if (!id) throw new Error('GOOGLE_DRIVE_ROOT_ID env var is required for Google Drive');
  return id;
}

async function connect() {
  if (cached) return cached;
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT env var is required for Google Drive');
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  // `googleapis` is large; load it only on the paths that talk to Drive.
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  cached = { drive: google.drive({ version: 'v3', auth }), auth };
  return cached;
}

const client = async () => (await connect()).drive;

/** A Drive query string literal: backslash and single quote are the two characters to escape. */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function toItem(f: drive_v3.Schema$File): DriveItem {
  return {
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    ...(f.md5Checksum ? { md5Checksum: f.md5Checksum } : {}),
    ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
    ...(f.size != null ? { size: Number(f.size) } : {}),
  };
}

/** True for the error `googleapis` raises when a file or folder id no longer exists. */
export function isNotFound(err: unknown): boolean {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404;
}

/**
 * Every child of a folder (not trashed), all pages. `kind` narrows to folders or
 * to real files; Google-native files are always excluded — see the file header.
 */
export async function listChildren(
  parentId: string,
  kind: 'folders' | 'files' | 'all' = 'all',
): Promise<DriveItem[]> {
  const drive = await client();
  const out: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `${q(parentId)} in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: 200,
      pageToken,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'drive',
      driveId: driveRootId(),
    });
    for (const f of res.data.files ?? []) {
      const isFolder = f.mimeType === FOLDER_MIME;
      if (!isFolder && f.mimeType?.startsWith('application/vnd.google-apps.')) continue;
      if (kind === 'folders' && !isFolder) continue;
      if (kind === 'files' && isFolder) continue;
      out.push(toItem(f));
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** One folder by name under a parent, or null. Drive permits duplicate names; the first (by name, then id) wins. */
export async function findFolder(parentId: string, name: string): Promise<DriveItem | null> {
  const drive = await client();
  const res = await drive.files.list({
    q: `${q(parentId)} in parents and name = ${q(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: 10,
    orderBy: 'createdTime',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'drive',
    driveId: driveRootId(),
  });
  const f = res.data.files?.[0];
  return f ? toItem(f) : null;
}

export async function createFolder(parentId: string, name: string): Promise<DriveItem> {
  const drive = await client();
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return toItem(res.data);
}

/**
 * Resolve a folder path from the drive root by name, e.g.
 * `['Training', 'Media-Gen', 'Datasets', 'JOE']`. `create` makes missing folders
 * (submissions); without it a missing segment returns null (materials are the
 * admin's to put there). Callers cache the resulting id — names are only ever
 * searched once.
 */
export async function resolvePath(segments: string[], opts?: { create?: boolean }): Promise<string | null> {
  let parent = driveRootId();
  for (const name of segments) {
    let next = await findFolder(parent, name);
    if (!next) {
      if (!opts?.create) return null;
      next = await createFolder(parent, name);
    }
    parent = next.id;
  }
  return parent;
}

export async function getFile(fileId: string): Promise<DriveItem> {
  const drive = await client();
  const res = await drive.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
  return toItem(res.data);
}

/** The bytes of a file. Buffered: callers cap the size first (images are a few MB). */
export async function downloadBuffer(fileId: string): Promise<Buffer> {
  const drive = await client();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/**
 * Upload with Drive's resumable protocol, as one streamed PUT with a known length
 * (the mirror reads the size from Storage), so a 250 MB working file never sits
 * in memory. The multipart helper in `googleapis` buffers; this does not.
 */
export async function uploadStream(input: {
  parentId: string;
  name: string;
  mimeType: string;
  size: number;
  body: Readable;
}): Promise<DriveItem> {
  const { auth } = await connect();

  const init = await auth.request({
    url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=' + encodeURIComponent(FILE_FIELDS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.mimeType,
      'X-Upload-Content-Length': String(input.size),
    },
    data: { name: input.name, parents: [input.parentId] },
  });
  // gaxios hands back a fetch `Headers` (case-insensitive `.get`), not a plain object.
  const headers = init.headers as unknown as Headers | Record<string, string>;
  const location =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('location')
      : (headers as Record<string, string>)['location'];
  if (!location) throw new Error('Drive did not return a resumable upload location');

  const done = await auth.request({
    url: location,
    method: 'PUT',
    headers: { 'Content-Type': input.mimeType, 'Content-Length': String(input.size) },
    data: input.body,
    // A stream cannot be replayed; a failed upload is retried by the caller from the start.
    retry: false,
  });
  return toItem(done.data as drive_v3.Schema$File);
}

/** Move to trash (recoverable), never delete. A missing file is already the goal state. */
export async function trashFile(fileId: string): Promise<void> {
  const drive = await client();
  try {
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}
