/**
 * The metadata a screenshot upload carries besides the pixels, parsed from an
 * untrusted request body (rule 10). Shared by the signed-URL `finalize` route
 * and the legacy base64 `upload` route, so the two paths record the same thing.
 */
import 'server-only';
import { after } from 'next/server';
import { parseInputSummary, type InputWindowSummary } from '../inputQuality';
import { isFingerprint } from '../screenFingerprint';
import { updateActivityPercent } from './activeSessionService';
import { recordCaptureIntegrity } from './integrityService';
import type { ActivityMethod } from '@/types/firestore';

export interface CaptureMeta {
  activityPercent: number | null;
  activityMethod: ActivityMethod | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  fingerprints: string[] | null;
  input: InputWindowSummary | null;
}

const DAY_MS = 86_400_000;

export function parseCaptureMeta(body: Record<string, unknown>, now = Date.now()): CaptureMeta {
  const pct = body.activityPercent;
  const start = body.windowStartMs;
  const end = body.windowEndMs;
  // A window is in the recent past and at most a day long; anything else is
  // dropped rather than trusted.
  const windowOk =
    typeof start === 'number' && typeof end === 'number' &&
    Number.isFinite(start) && Number.isFinite(end) &&
    start <= end && end <= now + 60_000 && now - start <= DAY_MS;
  const fps = body.fingerprints;
  return {
    activityPercent: typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct) : null,
    activityMethod: body.activityMethod === 'samples' || body.activityMethod === 'eventlog' ? body.activityMethod : null,
    windowStartMs: windowOk ? (start as number) : null,
    windowEndMs: windowOk ? (end as number) : null,
    fingerprints: Array.isArray(fps) && fps.length > 0 && fps.length <= 10 && fps.every(isFingerprint) ? (fps as string[]) : null,
    input: parseInputSummary(body.input),
  };
}

/**
 * After the response: the active session's latest activity %, and — for users
 * with input monitoring on — the capture's integrity record. Independent, so
 * they run together; neither may fail or slow the upload, so both run in
 * `after()` and swallow their own errors.
 */
export function afterCapture(uid: string, captureGroup: string, meta: CaptureMeta, inputMonitoring: boolean): void {
  const { windowStartMs, windowEndMs } = meta;
  after(() =>
    Promise.all([
      meta.activityPercent !== null &&
        updateActivityPercent(uid, meta.activityPercent).catch(err =>
          console.error('[screenshots] updateActivityPercent failed:', err),
        ),
      inputMonitoring && windowStartMs !== null && windowEndMs !== null &&
        recordCaptureIntegrity(uid, captureGroup, { ...meta, windowStartMs, windowEndMs }).catch(err =>
          console.error('[screenshots] recordCaptureIntegrity failed:', err),
        ),
    ]),
  );
}
