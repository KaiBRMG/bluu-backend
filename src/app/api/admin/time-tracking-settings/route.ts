import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import {
  ORG_SHIFT_BREAKS_REF,
  ORG_TIME_TRACKING_REF,
  getGroupOverrideSources,
  getShiftBreakPolicy,
  getOrgTimeTrackingSettings,
  recomputeTimeTrackingSettings,
} from '@/lib/services/timeTrackingSettingsService';
import {
  TIME_TRACKING_SETTING_KEYS,
  normalizeOverrides,
  parseOverridePatch,
  resolveTimeTrackingSettings,
  userOverridesFromDoc,
  type GroupOverrideSource,
  type TimeTrackingOverrides,
  type TimeTrackingSettings,
} from '@/lib/timeTrackingSettings';
import type { ShiftBreakPolicy } from '@/lib/shiftBreakPolicy';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Organization → group → user time-tracking settings
 * (Shift Management → Organization Settings).
 *
 * Authorisation is the `shift-management` page permission, the same tier as
 * every other Shift Management route. These are monitoring-policy settings,
 * not the auth graph, so the admin claim is not required (CLAUDE.md rule 3).
 */
async function canManage(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('shift-management');
}

/**
 * GET /api/admin/time-tracking-settings
 * Org defaults, every group's overrides, and every active time-tracked user's
 * overrides + resolved values with the source of each.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await canManage(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [org, shiftBreaks, groups, usersSnap] = await Promise.all([
      getOrgTimeTrackingSettings(),
      getShiftBreakPolicy(),
      getGroupOverrideSources(),
      adminDb.collection('users').get(),
    ]);
    const groupById = new Map(groups.map(g => [g.id, g]));
    const memberCounts = new Map<string, number>();

    const users = [];
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (data.isArchived === true) continue;
      if (!(data.permittedPageIds as string[] | undefined)?.includes('time-tracking')) continue;

      const groupIds: string[] = data.groups ?? [];
      for (const id of groupIds) memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);

      const overrides = userOverridesFromDoc(data);
      const resolved = resolveTimeTrackingSettings(
        org,
        groupIds.map(id => groupById.get(id)).filter((g): g is GroupOverrideSource => !!g),
        overrides,
      );
      users.push({
        uid: doc.id,
        displayName: data.displayName ?? '',
        photoURL: data.photoURL ?? null,
        groups: groupIds,
        overrides,
        effective: resolved.values,
        sources: resolved.sources,
      });
    }

    return NextResponse.json({
      org,
      shiftBreaks,
      groups: groups.map(g => ({ ...g, memberCount: memberCounts.get(g.id) ?? 0 })),
      users,
    });
  } catch (error: unknown) {
    console.error('[TimeTrackingSettings GET] Failed:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
});

/** Applies a validated patch: a value sets the override, `null` clears it. */
function applyPatch(
  current: TimeTrackingOverrides,
  patch: NonNullable<ReturnType<typeof parseOverridePatch>>,
): TimeTrackingOverrides {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as TimeTrackingOverrides;
}

/**
 * PUT /api/admin/time-tracking-settings
 *   { scope: 'org',   settings: TimeTrackingSettings }          — all three fields required
 *   { scope: 'group', id, overrides: { [key]: value | null } }  — null = inherit
 *   { scope: 'user',  id, overrides: { [key]: value | null } }  — null = inherit
 *   { scope: 'shift-breaks', policy: ShiftBreakPolicy }         — org-only, no recompute
 *
 * Re-resolves only the users the change can reach, and writes only those whose
 * effective values moved.
 */
export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await canManage(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const scope = body?.scope;
    let affected: string[] | undefined;

    if (scope === 'shift-breaks') {
      // Org-only and not denormalised: the renderer reads it through
      // /api/time-tracking/break-policy, so no user doc moves.
      const restrict = body?.policy?.restrictBreaksAtShiftEdges;
      if (typeof restrict !== 'boolean') {
        return NextResponse.json({ error: 'Invalid shift break policy' }, { status: 400 });
      }
      const policy: ShiftBreakPolicy = { restrictBreaksAtShiftEdges: restrict };
      await ORG_SHIFT_BREAKS_REF().set({
        ...policy,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: token.uid,
      });
      return NextResponse.json({ success: true, updatedUsers: 0 });
    }

    if (scope === 'org') {
      const patch = parseOverridePatch(body.settings);
      // Merged, so a key the caller did not send keeps its stored value: an
      // admin page loaded before a setting existed (rule 9c) posts the keys it
      // knows about, and must neither 400 nor wipe the new one. A key that was
      // never stored reads as its default (`normalizeOrgSettings`).
      const valid = patch && TIME_TRACKING_SETTING_KEYS.every(k => patch[k] !== null);
      if (!valid) {
        return NextResponse.json({ error: 'Invalid organization settings' }, { status: 400 });
      }
      await ORG_TIME_TRACKING_REF().set({
        ...(patch as Partial<TimeTrackingSettings>),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: token.uid,
      }, { merge: true });
      affected = undefined; // everyone
    } else if (scope === 'group' || scope === 'user') {
      const id = typeof body.id === 'string' ? body.id : '';
      const patch = parseOverridePatch(body.overrides);
      if (!id || !patch) {
        return NextResponse.json({ error: 'Invalid overrides' }, { status: 400 });
      }

      const ref = adminDb.collection(scope === 'group' ? 'groups' : 'users').doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ error: `Unknown ${scope}` }, { status: 404 });
      }
      const data = snap.data() ?? {};
      // Whole-map write, not dot-paths: a legacy user has no map yet, and a
      // dot-path set would create one holding only this key — silently
      // dropping the overrides `userOverridesFromDoc` derives for them.
      const current = scope === 'user' ? userOverridesFromDoc(data) : normalizeOverrides(data.timeTrackingOverrides);
      await ref.update({
        timeTrackingOverrides: applyPatch(current, patch),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (scope === 'user') invalidateUserCache(id);
      affected = scope === 'user' ? [id] : ((data.members as string[] | undefined) ?? []);
    } else {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }

    // Invalidates getUserById for every user whose effective values it writes.
    const updatedUsers = await recomputeTimeTrackingSettings(affected);
    invalidateAdminUsersCache();

    return NextResponse.json({ success: true, updatedUsers });
  } catch (error: unknown) {
    console.error('[TimeTrackingSettings PUT] Failed:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
});
