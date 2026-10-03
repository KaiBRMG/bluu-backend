import { adminDb } from '../firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { invalidateUserCache } from './userService';
import {
  TIME_TRACKING_SETTING_KEYS,
  normalizeOrgSettings,
  normalizeOverrides,
  resolveTimeTrackingSettings,
  userOverridesFromDoc,
  type GroupOverrideSource,
  type TimeTrackingSettings,
} from '../timeTrackingSettings';
import { normalizeShiftBreakPolicy, type ShiftBreakPolicy } from '../shiftBreakPolicy';

/** Single doc holding the organization-wide defaults. Server-only (rules deny clients). */
export const ORG_TIME_TRACKING_REF = () => adminDb.collection('org-settings').doc('time-tracking');

/**
 * Organization-only shift-break policy (no group/user overrides, nothing
 * denormalised onto user docs). Its own doc so the org-defaults `set()` above
 * can never wipe it. Server-only, like the rest of `org-settings`.
 */
export const ORG_SHIFT_BREAKS_REF = () => adminDb.collection('org-settings').doc('shift-breaks');

export async function getShiftBreakPolicy(): Promise<ShiftBreakPolicy> {
  const snap = await ORG_SHIFT_BREAKS_REF().get();
  return normalizeShiftBreakPolicy(snap.data());
}

export async function getOrgTimeTrackingSettings(): Promise<TimeTrackingSettings> {
  const snap = await ORG_TIME_TRACKING_REF().get();
  return normalizeOrgSettings(snap.data());
}

export async function getGroupOverrideSources(): Promise<GroupOverrideSource[]> {
  const snap = await adminDb.collection('groups').limit(200).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      name: typeof data.name === 'string' ? data.name : d.id,
      level: typeof data.level === 'number' ? data.level : 0,
      overrides: normalizeOverrides(data.timeTrackingOverrides),
    };
  });
}

/**
 * Re-resolves the effective time-tracking settings for `uids` (or every user
 * when omitted) and writes them onto each user doc — `enableIdleTimeout`,
 * `idleTimeoutMinutes`, `enableScreenshots` — which is what the renderer's live
 * `users/{uid}` snapshot and every time-tracking route already read. Call it
 * after anything that can change the outcome: org defaults, a group's
 * overrides, a user's overrides, or group membership.
 *
 * Writes only users whose values actually changed (rule 9), plus the one-time
 * `timeTrackingOverrides` latch for users still on the legacy fields. Returns
 * the number of user docs written.
 *
 * Cost: 1 org read + 1 groups read + the user reads (getAll, or one collection
 * read for the org-wide case).
 */
export async function recomputeTimeTrackingSettings(uids?: string[]): Promise<number> {
  if (uids && uids.length === 0) return 0;

  const [org, groups, userSnaps] = await Promise.all([
    getOrgTimeTrackingSettings(),
    getGroupOverrideSources(),
    uids
      ? adminDb.getAll(...uids.map(uid => adminDb.collection('users').doc(uid)))
      : adminDb.collection('users').get().then(s => s.docs),
  ]);
  const groupById = new Map(groups.map(g => [g.id, g]));

  const writer = adminDb.bulkWriter();
  const written: string[] = [];

  for (const snap of userSnaps) {
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    const userGroups = ((data.groups as string[] | undefined) ?? [])
      .map(id => groupById.get(id))
      .filter((g): g is GroupOverrideSource => !!g);
    const overrides = userOverridesFromDoc(data);
    const { values } = resolveTimeTrackingSettings(org, userGroups, overrides);

    const update: Record<string, unknown> = {};
    for (const key of TIME_TRACKING_SETTING_KEYS) {
      if (data[key] !== values[key]) update[key] = values[key];
    }
    // Latch the legacy → overrides migration so a later org change can't
    // reinterpret a resolved `false` as a user override.
    if (data.timeTrackingOverrides === undefined) update.timeTrackingOverrides = overrides;

    if (Object.keys(update).length === 0) continue;
    update.updatedAt = FieldValue.serverTimestamp();
    writer.update(snap.ref, update).catch(err => {
      console.error(`[TimeTrackingSettings] Failed to update ${snap.id}:`, err);
    });
    written.push(snap.id);
  }

  await writer.close();
  for (const uid of written) invalidateUserCache(uid);
  return written.length;
}
