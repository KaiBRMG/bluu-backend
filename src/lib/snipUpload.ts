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
