import type { SnipRow } from '@/types/snips';

/**
 * Uploads one capture and returns the live snip.
 *
 * Three legs, and the middle one is the point: the PNG goes **straight to Cloud
 * Storage** over a signed URL and never through a Vercel function (rule 9i). A
 * region capture is commonly 1–5 MB and base64 in a JSON body would add a third
 * on top of that, all billed as Fast Origin Transfer for bytes whose only
 * destination is a bucket.
 *
 *   1. `POST /api/snips/upload-url` → reserve an id, sign a slot
 *   2. `PUT` the blob at the signed URL → the bytes, direct
 *   3. `POST /api/snips`            → finalise; the server reads the real size
 *                                      off the object rather than trusting us
 *
 * A failure at leg 2 or 3 leaves a pending reservation, which the daily cron
 * sweeps along with its object — nothing here needs to clean up after itself.
 */
export async function uploadSnip(
  idToken: string,
  capture: { dataBase64: string; width: number; height: number },
): Promise<SnipRow> {
  const blob = base64ToPngBlob(capture.dataBase64);

  const slotRes = await fetch('/api/snips/upload-url', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: blob.size }),
  });
  if (!slotRes.ok) {
    throw new Error(await errorMessage(slotRes, 'Could not start the upload'));
  }
  const { id, uploadUrl } = (await slotRes.json()) as { id: string; uploadUrl: string };

  // The signature pins the content type, so this header is not decoration —
  // Storage rejects the PUT outright if it disagrees with what was signed.
  //
  // A PUT is never a "simple" CORS request, so the browser always sends a
  // preflight OPTIONS to storage.googleapis.com first. If the bucket has no CORS
  // policy, that preflight fails and `fetch` rejects with a bare
  // `TypeError: Failed to fetch` — no status, no body, and nothing to tell the
  // user apart from being offline. Hence the translation below: this one failure
  // mode is a bucket misconfiguration, not something a retry will fix, and the
  // generic message sends people looking in the wrong place. See the CORS
  // section of documentation/snipping-tool.md.
  let putRes: Response;
  try {
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });
  } catch {
    throw new Error(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'You are offline — the snip was not uploaded.'
        : 'Storage rejected the upload (CORS). The bucket needs its CORS policy applied — see storage-cors.json.',
    );
  }
  if (!putRes.ok) throw new Error(`The upload did not complete (${putRes.status})`);

  const finalRes = await fetch('/api/snips', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, width: capture.width, height: capture.height }),
  });
  if (!finalRes.ok) {
    throw new Error(await errorMessage(finalRes, 'The snip could not be saved'));
  }

  const { snip } = (await finalRes.json()) as { snip: SnipRow };
  return snip;
}

/** The owner's snip quota is full; every further reservation will be refused. */
export class SnipQuotaFullError extends Error {}

/**
 * Uploads a file the user dropped on the library page, and returns the live
 * snip.
 *
 * The same three legs as `uploadSnip`, and deliberately the *same* legs rather
 * than a route of its own: an import is a snip whose bytes came from disk
 * instead of from `desktopCapturer`, so it wants the same reservation, the same
 * quota, the same retention stamp and the same share token. The only two
 * differences travel in leg one — `source: 'import'` (which the card's badge
 * reads back) and `contentType`, because a dropped JPEG has to be stored and
 * served as a JPEG rather than being re-encoded into the PNG the capture path
 * always produces.
 *
 * **The bytes go straight to Cloud Storage**, exactly as a capture's do, which
 * is the whole reason this is worth doing properly: a photo dropped in here is
 * routinely larger than any screenshot the tool takes, and routing it through a
 * function would be rule 9i's worst case with none of the excuses.
 *
 * Dimensions are read in the browser before the upload, because the server has
 * no way to get them — it never sees the file, and probing the object would
 * mean downloading it back through a function. A file whose dimensions cannot
 * be read is refused here rather than finalised with zeros, since `width` and
 * `height` are what reserve the box on the public page.
 *
 * **Stills only.** There is no video import: a recording carries a durable
 * on-disk queue, a poster frame and a resumable session, and none of that
 * applies to a file that is already sitting on the user's machine.
 */
export async function importSnip(
  idToken: string,
  file: File,
  dimensions: { width: number; height: number },
  /**
   * Bytes sent, 0–1. Optional, and only the PUT leg reports — the two JSON
   * legs either side of it are a few hundred bytes each and a bar that jumped
   * 0 → 2% → 100% would describe the wrong thing.
   */
  onProgress?: (fraction: number) => void,
): Promise<SnipRow> {
  const slotRes = await fetch('/api/snips/upload-url', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: file.size, kind: 'image', source: 'import', contentType: file.type }),
  });
  if (!slotRes.ok) {
    const message = await errorMessage(slotRes, 'Could not start the upload');
    // 409 is the reservation's quota refusal — typed so a batch import can stop
    // rather than spend a request per remaining file on the same answer.
    throw slotRes.status === 409 ? new SnipQuotaFullError(message) : new Error(message);
  }
  const { id, uploadUrl } = (await slotRes.json()) as { id: string; uploadUrl: string };

  // **`XMLHttpRequest`, not `fetch`, and only here.** An import is a file the
  // user chose off their own disk and can be two orders of magnitude larger
  // than a screen capture, so "Uploading…" with no number is a dialog that
  // looks hung. `fetch` still has no upload-progress event that ships
  // everywhere; XHR's `upload.onprogress` does. The request is otherwise
  // identical — same signed URL, same pinned content type, same preflight.
  const status = await new Promise<number>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl, true);
    // Must match what the slot was signed for exactly — Storage rejects the
    // PUT otherwise. See the CORS note in `uploadSnip` for why a rejection
    // here arrives with no status at all.
    request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = event => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => resolve(request.status);
    // A refused preflight and a dropped connection both land here with status
    // 0 and no body — the XHR equivalent of `fetch`'s bare `TypeError`.
    request.onerror = () => reject(new Error('network'));
    request.onabort = () => reject(new Error('network'));
    request.send(file);
  }).catch(() => {
    throw new Error(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'You are offline — the image was not uploaded.'
        : 'Storage rejected the upload (CORS). The bucket needs its CORS policy applied — see storage-cors.json.',
    );
  });
  if (status < 200 || status >= 300) {
    throw new Error(`The upload did not complete (${status})`);
  }
  // The bytes are in the bucket; the finalise below is the only thing left.
  onProgress?.(1);

  const finalRes = await fetch('/api/snips', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      width: dimensions.width,
      height: dimensions.height,
      // The file already has a name and it is the only thing about this snip
      // the user has actually written. The server normalises and caps it.
      title: file.name.replace(/\.[^.]+$/, ''),
    }),
  });
  if (!finalRes.ok) {
    throw new Error(await errorMessage(finalRes, 'The image could not be saved'));
  }

  const { snip } = (await finalRes.json()) as { snip: SnipRow };
  return snip;
}

/**
 * Uploads one finished recording and returns the live snip.
 *
 * Same three legs as `uploadSnip` and the same reasoning behind the middle one
 * — but the middle leg runs **in the main process**, not here, and that is the
 * whole difference:
 *
 *   1. `POST /api/snips/upload-url` → reserve an id, sign the video slot and
 *      (because the kind is `video`) the poster slot beside it
 *   2. `snip.uploadRecording` → MAIN streams the temp file to Cloud Storage
 *   3. `POST /api/snips`            → finalise; the server reads the real size
 *                                      off the object rather than trusting us
 *
 * Leg 2 cannot be a `fetch` from here. The recording is a file on disk that
 * this context deliberately has no path to, and reading a ten-minute capture
 * into renderer memory to PUT it would put a few hundred megabytes in the
 * same heap that is running the app. Main pipes it from disk, so the peak cost
 * of an upload is one socket buffer regardless of how long the recording ran.
 *
 * **A failure does not lose the recording.** Main keeps it in an on-disk queue
 * in `userData` until an upload actually succeeds, so a dropped connection, a
 * crash or a quit costs a retry rather than the take. Leg 2 is itself a
 * resumable session that continues from the bucket's confirmed offset, so an
 * interruption at 95% does not restart at zero. The only thing that discards
 * a file is leg 1 being *refused* — quota, size, a revoked page permission —
 * because that recording has nowhere it could ever go.
 */
export async function uploadSnipRecording(
  idToken: string,
  recording: {
    token: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    hasPoster: boolean;
  },
): Promise<SnipRow> {
  const api = window.electronAPI?.snip;
  if (!api?.uploadRecording) {
    // Unreachable in practice — a `snip:recorded` event can only arrive from a
    // shell that has this handler — but the bridge is typed optional for a
    // renderer older than its shell (rule 9c), and an unchecked call here
    // would be a TypeError instead of a message.
    throw new Error('This version of the desktop app cannot upload recordings.');
  }

  const slotRes = await fetch('/api/snips/upload-url', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: recording.bytes, kind: 'video' }),
  });
  if (!slotRes.ok) {
    // The slot is the first thing that can refuse — quota, size, a revoked
    // page permission. The file is main's, so tell it to let go of it rather
    // than leaving a temp file for a recording that will never be stored.
    // `Promise.resolve(...)` — the method is optional, and `.catch` on the
    // `undefined` that `?.()` yields would throw rather than swallow.
    await Promise.resolve(api.discardRecording?.(recording.token)).catch(() => {});
    throw new Error(await errorMessage(slotRes, 'Could not start the upload'));
  }
  const { id, uploadUrl, resumable, posterUploadUrl } = (await slotRes.json()) as {
    id: string;
    uploadUrl: string;
    resumable?: boolean;
    posterUploadUrl?: string;
  };

  const put = await api.uploadRecording({
    token: recording.token,
    uploadUrl,
    resumable: resumable !== false,
    // Only offered when there is a poster to send. A slot signed and never
    // used is swept with the reservation, so an absent poster costs nothing.
    ...(recording.hasPoster && posterUploadUrl ? { posterUploadUrl } : {}),
  });
  if (!put.success) {
    // **Deliberately does not discard.** The recording is still in main's
    // on-disk queue with its error recorded, which is the entire point: a
    // transfer that failed is work the user still has, and the Snipping Tool
    // page offers it back with a Retry. Only a refused *reservation* (above)
    // throws the file away, because that one has nowhere to go.
    throw new Error(put.error || 'The recording could not be uploaded');
  }

  const finalRes = await fetch('/api/snips', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      width: recording.width,
      height: recording.height,
      durationMs: recording.durationMs,
    }),
  });
  if (!finalRes.ok) {
    throw new Error(await errorMessage(finalRes, 'The recording could not be saved'));
  }

  const { snip } = (await finalRes.json()) as { snip: SnipRow };
  return snip;
}

/**
 * `atob` in a loop rather than `fetch('data:...')`.
 *
 * A data URL of a multi-megabyte PNG is a multi-megabyte string handed to the
 * URL parser, and building one only to parse it straight back is two extra
 * copies of the image in renderer memory for no benefit.
 */
function base64ToPngBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * The server's message when there is one, the fallback otherwise.
 *
 * The parse is guarded because a non-JSON error body — an HTML 500, a proxy
 * timeout, an empty 502 — would otherwise throw a `SyntaxError` that replaces
 * the real failure with a parsing one (the same trap documented against
 * `useAdminData` in CLAUDE.md).
 */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON — fall through.
  }
  return `${fallback} (${response.status})`;
}
