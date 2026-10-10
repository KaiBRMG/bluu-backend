/**
 * Integrity signals — input quality and unchanged screens, per capture and per
 * day. Written at each screenshot upload for users with `inputMonitoring` on;
 * read by Chatter Analytics (admin views only).
 *
 * **Display only.** Nothing here touches idle state, the time ledger or pay.
 *
 * **Server-only collections, on purpose.** An agent can read their own
 * `screenshots` and `active_sessions` docs straight from Firestore, so a flag
 * stored there would reach the agent — and flags are shown to admins only.
 * These three are Admin SDK only (firestore.rules), like the rest of CA salary:
 *
 * | Collection | Doc | Holds |
 * |---|---|---|
 * | `integrity-captures` | captureGroup | one capture: window, activity, unchanged?, input summary |
 * | `integrity-days` | `{uid}_{day}` | per-day counters, so a week of agents is ~200 doc reads |
 * | `integrity-state` | uid | the previous capture's fingerprints |
 *
 * Day keys are the salary day (`Africa/Harare`), the same day Chatter
 * Analytics and BuddyX use, so a flag lands on the day its figures do.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { toDayKey } from '../salary/salaryDate';
import { sameScreen } from '../screenFingerprint';
import type { InputWindowSummary } from '../inputQuality';
import type { ActivityMethod } from '@/types/firestore';
import type { CaptureMeta } from './captureMeta';

export const INTEGRITY_CAPTURES = 'integrity-captures';
export const INTEGRITY_DAYS = 'integrity-days';
const INTEGRITY_STATE = 'integrity-state';

/** A window longer than this is not credited to "static" in full — a gap, not a screen. */
const MAX_WINDOW_MINUTES = 60;

export interface IntegrityCaptureDocument {
  uid: string;
  captureGroup: string;
  at: Timestamp;
  day: string;
  windowStartMs: number;
  windowEndMs: number;
  activityPercent: number | null;
  activityMethod: ActivityMethod | null;
  /** Every screen matched the previous capture's. `null` when there was nothing to compare. */
  unchanged: boolean | null;
  input: InputWindowSummary | null;
}

export interface IntegrityDayDocument {
  uid: string;
  day: string;
  captures: number;
  /** Captures with a fingerprint comparison (the denominator for `unchangedCaptures`). */
  comparedCaptures: number;
  unchangedCaptures: number;
  /** Window minutes ending in an unchanged capture. */
  staticMinutes: number;
  /** Working minutes the input monitor covered. */
  monitoredMinutes: number;
  keys: number;
  modifierOnlyMinutes: number;
  regularMinutes: number;
  /** The most recent collector and permission seen that day. */
  inputSource: InputWindowSummary['source'] | null;
  permission: InputWindowSummary['permission'] | null;
  updatedAt: Timestamp;
}

/**
 * Record one capture's integrity signals. Runs after the upload response —
 * a failure here must never fail a screenshot. Cost: 1 read (the state doc)
 * + 3 writes, only for users with input monitoring on. The capture instant is
 * the window's end.
 */
export async function recordCaptureIntegrity(
  uid: string,
  captureGroup: string,
  meta: CaptureMeta & { windowStartMs: number; windowEndMs: number },
): Promise<void> {
  const { windowStartMs, windowEndMs, fingerprints, input } = meta;
  const stateRef = adminDb.collection(INTEGRITY_STATE).doc(uid);
  const previous = (await stateRef.get()).get('fingerprints') as string[] | undefined;

  // Unchanged only when every screen matches, screen for screen. A different
  // monitor count is a change (someone plugged in a display), not a match.
  let unchanged: boolean | null = null;
  if (fingerprints?.length && previous?.length) {
    unchanged = previous.length === fingerprints.length && fingerprints.every((fp, i) => sameScreen(fp, previous[i]));
  }
  const windowMinutes = Math.max(0, Math.min(MAX_WINDOW_MINUTES, Math.round((windowEndMs - windowStartMs) / 60_000)));
  const day = toDayKey(windowEndMs);

  // `create`, not `set`: a replayed finalise (a retry after a dropped
  // response) fails the whole batch here instead of counting the day twice.
  const batch = adminDb.batch();
  batch.create(adminDb.collection(INTEGRITY_CAPTURES).doc(captureGroup), {
    uid,
    captureGroup,
    at: Timestamp.fromMillis(windowEndMs),
    day,
    windowStartMs,
    windowEndMs,
    activityPercent: meta.activityPercent,
    activityMethod: meta.activityMethod,
    unchanged,
    input,
  } satisfies IntegrityCaptureDocument);
  batch.set(
    adminDb.collection(INTEGRITY_DAYS).doc(`${uid}_${day}`),
    {
      uid,
      day,
      captures: FieldValue.increment(1),
      comparedCaptures: FieldValue.increment(unchanged === null ? 0 : 1),
      unchangedCaptures: FieldValue.increment(unchanged ? 1 : 0),
      staticMinutes: FieldValue.increment(unchanged ? windowMinutes : 0),
      monitoredMinutes: FieldValue.increment(input?.minutes ?? 0),
      keys: FieldValue.increment(input?.keys ?? 0),
      modifierOnlyMinutes: FieldValue.increment(input?.modifierOnlyMinutes ?? 0),
      regularMinutes: FieldValue.increment(input?.regularMinutes ?? 0),
      ...(input && { inputSource: input.source, permission: input.permission }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (fingerprints?.length) batch.set(stateRef, { fingerprints });
  try {
    await batch.commit();
  } catch (err) {
    if ((err as { code?: number }).code === 6 /* ALREADY_EXISTS */) return;
    throw err;
  }
}

/**
 * Day counters over a day range, grouped by uid. A **range query, not a
 * `getAll` of uid × day**: only monitored agents have docs at all, and a
 * by-id read bills every absent doc too — 40 agents × 30 days would be 1,200
 * reads for a page that mostly has nothing to show. With `uid`, one agent's
 * days only (composite index `uid` + `day`).
 */
export async function getIntegrityDays(from: string, to: string, uid?: string): Promise<Map<string, IntegrityDayDocument[]>> {
  const out = new Map<string, IntegrityDayDocument[]>();
  let query: FirebaseFirestore.Query = adminDb.collection(INTEGRITY_DAYS);
  if (uid) query = query.where('uid', '==', uid);
  const snap = await query.where('day', '>=', from).where('day', '<=', to).get();
  for (const d of snap.docs) {
    const doc = d.data() as IntegrityDayDocument;
    const list = out.get(doc.uid) ?? [];
    list.push(doc);
    out.set(doc.uid, list);
  }
  return out;
}

/** One user's captures in a window — the report's shift detail. Bounded; a shift is ~40 captures. */
export async function getIntegrityCaptures(uid: string, startMs: number, endMs: number): Promise<IntegrityCaptureDocument[]> {
  const snap = await adminDb
    .collection(INTEGRITY_CAPTURES)
    .where('uid', '==', uid)
    .where('at', '>=', Timestamp.fromMillis(startMs))
    .where('at', '<=', Timestamp.fromMillis(endMs))
    .orderBy('at', 'asc')
    .limit(400)
    .get();
  return snap.docs.map(d => d.data() as IntegrityCaptureDocument);
}
