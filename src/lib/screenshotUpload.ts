/**
 * Upload one screenshot capture from the renderer — direct to Cloud Storage.
 *
 * 1. `POST /api/time-tracking/screenshots/upload-url` signs one slot per screen.
 * 2. Each PNG is PUT straight to its signed URL; the bytes never cross Vercel
 *    (rule 9i). Needs the bucket's CORS policy (`storage-cors.json`).
 * 3. `POST /api/time-tracking/screenshots/finalize` records the capture.
 *
 * **Falls back to the legacy base64 route** when any step of the signed path
 * fails — a CORS misconfiguration or a blocked `storage.googleapis.com` must
 * cost bandwidth, never the screenshot. The fallback carries the same metadata.
 *
 * **Every fallback is reported to Sentry** (`area: screenshots`, tagged with the
 * step that failed): the direct path exists to cut Fast Origin Transfer, and a
 * silent fallback would let a bucket CORS regression bring that cost back
 * unseen.
 *
 * Throws only when the final attempt cannot reach the server at all, which is
 * what the caller's "Network Issues" handling has always keyed on.
 */

import * as Sentry from '@sentry/nextjs';
import type { InputWindowSummary } from './inputQuality';
import type { ActivityMethod } from '@/types/firestore';

/** Decode `captureScreenshot`'s base64 PNGs once; the Blobs feed both the fingerprint and the PUT. */
export async function decodeScreens(screens: string[]): Promise<Blob[]> {
  return Promise.all(screens.map(async b64 => (await fetch(`data:image/png;base64,${b64}`)).blob()));
}

// Every request is time-boxed. A fetch has no timeout of its own, and one that
// never settles (a half-open connection, a captive portal) used to stall the
// capture callback that schedules the NEXT screenshot — ending captures for the
// rest of the session. A timeout rejects like any other failure: the signed
// path falls back to the legacy route, and the legacy route throws to the
// caller's "Network Issues" handling.
const API_TIMEOUT_MS = 30_000;
const PUT_TIMEOUT_MS = 60_000;     // full-resolution PNGs, possibly several screens
const LEGACY_TIMEOUT_MS = 90_000;  // the same bytes again, base64 through a function

class UploadStepError extends Error {
  constructor(readonly step: 'sign' | 'put' | 'finalize', detail: string) {
    super(`${step}: ${detail}`);
  }
}

export interface CaptureUploadMeta {
  activityPercent: number | null;
  activityMethod: ActivityMethod | null;
  windowStartMs: number;
  windowEndMs: number;
  fingerprints: string[] | null;
  input: InputWindowSummary | null;
}

function metaBody(meta: CaptureUploadMeta) {
  return {
    ...(meta.activityPercent !== null && { activityPercent: meta.activityPercent }),
    ...(meta.activityMethod && { activityMethod: meta.activityMethod }),
    windowStartMs: meta.windowStartMs,
    windowEndMs: meta.windowEndMs,
    ...(meta.fingerprints && { fingerprints: meta.fingerprints }),
    ...(meta.input && { input: meta.input }),
  };
}

async function signedUpload(idToken: string, blobs: Blob[], meta: CaptureUploadMeta): Promise<void> {
  const auth = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
  const signRes = await fetch('/api/time-tracking/screenshots/upload-url', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ count: blobs.length }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!signRes.ok) throw new UploadStepError('sign', `HTTP ${signRes.status}`);
  const { captureGroup, slots } = (await signRes.json()) as {
    captureGroup: string;
    slots: Array<{ path: string; uploadUrl: string }>;
  };
  if (!Array.isArray(slots) || slots.length !== blobs.length) throw new UploadStepError('sign', 'slot count mismatch');

  const puts = await Promise.all(
    slots.map((slot, i) => fetch(slot.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: blobs[i],
      signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    })),
  );
  const failed = puts.find(r => !r.ok);
  if (failed) throw new UploadStepError('put', `HTTP ${failed.status}`);

  const finRes = await fetch('/api/time-tracking/screenshots/finalize', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ captureGroup, paths: slots.map(s => s.path), ...metaBody(meta) }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!finRes.ok) throw new UploadStepError('finalize', `HTTP ${finRes.status}`);
}

export async function uploadCapture(idToken: string, screens: string[], blobs: Blob[], meta: CaptureUploadMeta): Promise<void> {
  try {
    await signedUpload(idToken, blobs, meta);
    return;
  } catch (err) {
    // A failed fetch() (CORS, offline) is a TypeError — the PUT is the only
    // cross-origin step, so that is where it almost always comes from.
    const step = err instanceof UploadStepError ? err.step : 'put';
    Sentry.captureException(err, { tags: { area: 'screenshots', step }, level: 'warning' });
  }
  await fetch('/api/time-tracking/screenshots/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ screens, ...metaBody(meta) }),
    signal: AbortSignal.timeout(LEGACY_TIMEOUT_MS),
  });
}
