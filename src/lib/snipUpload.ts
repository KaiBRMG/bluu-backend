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
