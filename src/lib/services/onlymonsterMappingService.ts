/**
 * OnlyMonster identity mapping — the `directory` stage, and an admin's manual links.
 *
 * Two collections, keyed by the OnlyMonster id and rewritten only when
 * something in them changed (rule 9):
 *
 * - `onlymonster-accounts/{accountId}` → the Bluu creator or sub-account, by
 *   handle, among `platform: 'onlyfans'` Bluu accounts only (`lib/onlymonster/mapping.ts`).
 * - `onlymonster-members/{memberId}` → the Bluu user, by email.
 *
 * **Decisions this file implements (2026-11-11):**
 * - An OnlyMonster account with no Bluu match is **ignored for now**: its doc is
 *   written with `match: 'none'`, so a later manual link works, but nothing alerts
 *   and later stages skip it.
 * - Fansly accounts are recorded and skipped by every stage.
 * - An empty `/accounts` or `/members` list while stored docs exist is **suspect**
 *   (the probe once got 0 members, then 9). The stored mapping is kept, a warning
 *   is returned, and nothing is unmapped.
 * - A doc OnlyMonster stops listing is kept with `listed: false`; history may
 *   reference it.
 *
 * Members feed activity analytics and the D13 cross-check only. **Pay never reads
 * them**: a sale's holder comes from the shift schedule.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { normalizeEmail } from '../authEmail';
import { omPaginateCursor, omPaginateOffset } from '../onlymonster/client';
import { COLLECTIONS } from '../onlymonster/constants';
import { ONLYFANS_PLATFORM } from '../creators/accountPlatform';
import {
  buildMemberEmailIndex,
  buildOnlyFansHandleIndex,
  isSuspectEmpty,
  resolveAccount,
  resolveAccountPinned,
  resolveMember,
  type BluuAccountForMatch,
} from '../onlymonster/mapping';
import { normaliseId, type OmAccount, type OmMember } from '../onlymonster/types';
import type { OnlyMonsterAccountDocument, OnlyMonsterMemberDocument } from '@/types/firestore';

const ACCOUNTS = COLLECTIONS.accounts;
const MEMBERS = COLLECTIONS.members;

interface Roster {
  users: Array<{ uid: string; workEmail: string }>;
  accounts: BluuAccountForMatch[];
}

/** Every creator and sub-account, field-masked. Archived ones are kept on purpose: historical pay must still resolve. */
async function readBluuAccounts(): Promise<BluuAccountForMatch[]> {
  const [creatorsSnap, subsSnap] = await Promise.all([
    adminDb.collection('creators').select('creatorID', 'stageName', 'OFID', 'platform').get(),
    adminDb.collection('creator-subaccounts').select('stageName', 'OFID', 'platform').get(),
  ]);
  return [
    ...creatorsSnap.docs.map(d => ({
      id: (d.get('creatorID') as string | undefined) ?? d.id,
      stageName: (d.get('stageName') as string | undefined) ?? '',
      OFID: (d.get('OFID') as string | undefined) ?? null,
      platform: (d.get('platform') as string | undefined) ?? null,
    })),
    ...subsSnap.docs.map(d => ({
      id: d.id,
      stageName: (d.get('stageName') as string | undefined) ?? '',
      OFID: (d.get('OFID') as string | undefined) ?? null,
      platform: (d.get('platform') as string | undefined) ?? null,
    })),
  ];
}

async function readUsers(): Promise<Roster['users']> {
  const usersSnap = await adminDb.collection('users').select('uid', 'workEmail').get();
  return usersSnap.docs.map(d => ({
    uid: (d.get('uid') as string | undefined) ?? d.id,
    workEmail: (d.get('workEmail') as string | undefined) ?? '',
  }));
}

async function readRoster(): Promise<Roster> {
  const [users, accounts] = await Promise.all([readUsers(), readBluuAccounts()]);
  return { users, accounts };
}

function differs<T extends object>(a: T | undefined, b: T, keys: (keyof T)[]): boolean {
  if (!a) return true;
  return keys.some(k => (a[k] ?? null) !== (b[k] ?? null));
}

export interface DirectoryResult {
  counts: Record<string, number>;
  warnings: string[];
}

/** The `directory` stage: `/accounts` (with expired subscriptions) + `/members`, matched and written where changed. */
export async function syncDirectory(): Promise<DirectoryResult> {
  const [omAccounts, omMembers, roster, accountSnap, memberSnap] = await Promise.all([
    omPaginateCursor<OmAccount>('/api/v0/accounts', { limit: 1000, withExpiredSubscriptions: true }, { items: 'accounts', cursor: 'nextCursor' }),
    omPaginateOffset<OmMember>('/api/v0/members', {}, ['users', 'items'], 50),
    readRoster(),
    adminDb.collection(ACCOUNTS).get(),
    adminDb.collection(MEMBERS).get(),
  ]);

  const storedAccounts = new Map(accountSnap.docs.map(d => [d.id, d.data() as OnlyMonsterAccountDocument]));
  const storedMembers = new Map(memberSnap.docs.map(d => [d.id, d.data() as OnlyMonsterMemberDocument]));
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const now = Timestamp.now();
  const writer = adminDb.batch();
  let written = 0;
  const set = (ref: FirebaseFirestore.DocumentReference, data: object) => {
    writer.set(ref, data, { merge: true });
    written += 1;
  };

  // ── Accounts ──
  const handleIndex = buildOnlyFansHandleIndex(roster.accounts);
  const accountsById = new Map(roster.accounts.map(a => [a.id, a]));
  if (isSuspectEmpty(omAccounts.length, storedAccounts.size)) {
    warnings.push(`/accounts returned 0 accounts while ${storedAccounts.size} are stored; kept the stored mapping.`);
  } else {
    const seen = new Set<string>();
    let onlyfansMapped = 0;
    for (const a of omAccounts) {
      const accountId = normaliseId(a.id);
      const platformAccountId = normaliseId(a.platform_account_id);
      if (!accountId || !platformAccountId) continue;
      seen.add(accountId);
      const prev = storedAccounts.get(accountId);
      // Only an OnlyFans account can map; a Fansly account is recorded and skipped.
      const resolved =
        a.platform === ONLYFANS_PLATFORM
          ? resolveAccountPinned(
              { username: a.username, platformAccountId, manualCreatorId: prev?.manualCreatorId ?? null },
              prev,
              handleIndex,
              accountsById,
            )
          : { creatorId: null, creatorName: null, match: 'none' as const, warning: null };
      if (resolved.warning) warnings.push(resolved.warning);
      if (resolved.creatorId && a.platform === ONLYFANS_PLATFORM) onlyfansMapped += 1;
      const next: OnlyMonsterAccountDocument = {
        accountId,
        platform: a.platform,
        platformAccountId,
        username: a.username ?? null,
        name: a.name ?? null,
        customLabel: a.custom_label ?? null,
        creatorId: resolved.creatorId,
        creatorName: resolved.creatorName,
        match: resolved.match,
        manualCreatorId: prev?.manualCreatorId ?? null,
        linkedBy: prev?.linkedBy ?? null,
        linkedAt: prev?.linkedAt ?? null,
        listed: true,
        syncedAt: now,
      };
      if (differs(prev, next, ['platform', 'platformAccountId', 'username', 'name', 'customLabel', 'creatorId', 'creatorName', 'match', 'listed'])) {
        set(adminDb.collection(ACCOUNTS).doc(accountId), next);
      }
    }
    for (const [id, prev] of storedAccounts) {
      if (!seen.has(id) && prev.listed !== false) set(adminDb.collection(ACCOUNTS).doc(id), { listed: false, syncedAt: now });
    }
    counts.accounts = omAccounts.length;
    counts.onlyfansAccounts = omAccounts.filter(a => a.platform === ONLYFANS_PLATFORM).length;
    counts.onlyfansMapped = onlyfansMapped;
  }

  // ── Members ──
  const emailIndex = buildMemberEmailIndex(roster.users, normalizeEmail);
  const knownUids = new Set(roster.users.map(u => u.uid));
  if (isSuspectEmpty(omMembers.length, storedMembers.size)) {
    warnings.push(`/members returned 0 members while ${storedMembers.size} are stored; kept the stored mapping.`);
  } else {
    const seen = new Set<string>();
    let mapped = 0;
    for (const m of omMembers) {
      const memberId = normaliseId(m.id);
      if (!memberId) continue;
      seen.add(memberId);
      const prev = storedMembers.get(memberId);
      const { uid, match } = resolveMember({ email: m.email, manualUid: prev?.manualUid ?? null }, emailIndex, normalizeEmail, knownUids);
      if (uid) mapped += 1;
      const next: OnlyMonsterMemberDocument = {
        memberId,
        name: m.name ?? null,
        customName: m.customName ?? null,
        email: m.email ?? null,
        uid,
        match,
        manualUid: prev?.manualUid ?? null,
        linkedBy: prev?.linkedBy ?? null,
        linkedAt: prev?.linkedAt ?? null,
        listed: true,
        syncedAt: now,
      };
      if (differs(prev, next, ['name', 'customName', 'email', 'uid', 'match', 'listed'])) {
        set(adminDb.collection(MEMBERS).doc(memberId), next);
      }
    }
    for (const [id, prev] of storedMembers) {
      if (!seen.has(id) && prev.listed !== false) set(adminDb.collection(MEMBERS).doc(id), { listed: false, syncedAt: now });
    }
    counts.members = omMembers.length;
    counts.membersMapped = mapped;
  }

  if (written > 0) await writer.commit();
  counts.written = written;
  return { counts, warnings };
}

/**
 * An admin's manual account link. `null` clears it and falls back to the
 * automatic match immediately, so the mapping screen shows the result without
 * waiting for a sync. The target must be an OnlyFans Bluu account.
 */
export async function setManualAccountLink(accountId: string, creatorId: string | null, actorUid: string): Promise<void> {
  const ref = adminDb.collection(ACCOUNTS).doc(accountId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Unknown OnlyMonster account');
  const data = snap.data() as OnlyMonsterAccountDocument;
  if (data.platform !== ONLYFANS_PLATFORM) throw new Error('Only OnlyFans accounts are synced; this account is not one.');

  const accounts = await readBluuAccounts();
  const accountsById = new Map(accounts.map(a => [a.id, a]));
  if (creatorId) {
    const target = accountsById.get(creatorId);
    if (!target) throw new Error('Unknown creator');
    if (target.platform !== ONLYFANS_PLATFORM) throw new Error(`${target.stageName} is not an OnlyFans account in Bluu. Set its platform in Creator Management first.`);
  }
  const resolved = resolveAccount({ username: data.username, manualCreatorId: creatorId }, buildOnlyFansHandleIndex(accounts), accountsById);
  await ref.update({
    manualCreatorId: creatorId,
    creatorId: resolved.creatorId,
    creatorName: resolved.creatorName,
    match: resolved.match,
    linkedBy: actorUid,
    linkedAt: FieldValue.serverTimestamp(),
  });
}

export async function setManualMemberLink(memberId: string, uid: string | null, actorUid: string): Promise<void> {
  const ref = adminDb.collection(MEMBERS).doc(memberId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Unknown OnlyMonster member');
  if (uid) {
    const user = await adminDb.collection('users').doc(uid).get();
    if (!user.exists) throw new Error('Unknown user');
    await ref.update({ manualUid: uid, uid, match: 'manual', linkedBy: actorUid, linkedAt: FieldValue.serverTimestamp() });
    return;
  }
  const data = snap.data() as OnlyMonsterMemberDocument;
  const users = await readUsers();
  const { uid: resolved, match } = resolveMember(
    { email: data.email, manualUid: null },
    buildMemberEmailIndex(users, normalizeEmail),
    normalizeEmail,
    new Set(users.map(u => u.uid)),
  );
  await ref.update({ manualUid: null, uid: resolved, match, linkedBy: actorUid, linkedAt: FieldValue.serverTimestamp() });
}

/** The Bluu creators and sub-accounts on OnlyFans: the only valid manual-link targets. Two field-masked reads. */
export async function onlyFansBluuAccountIds(): Promise<string[]> {
  const accounts = await readBluuAccounts();
  return accounts.filter(a => a.platform === ONLYFANS_PLATFORM).map(a => a.id);
}

let mappedCache: { at: number; ids: string[] } | null = null;

/**
 * Every Bluu creator or sub-account an OnlyFans account in OnlyMonster maps to:
 * the dispute dialog's creator picker and an admin's Fan Analytics scope.
 * Field-masked and cached 60 s per instance; the map changes a few times a year.
 */
export async function mappedCreatorIds(): Promise<string[]> {
  if (mappedCache && Date.now() - mappedCache.at < 60_000) return mappedCache.ids;
  const snap = await adminDb.collection(ACCOUNTS).where('platform', '==', ONLYFANS_PLATFORM).select('creatorId', 'listed').get();
  const ids = [
    ...new Set(
      snap.docs
        .filter(d => d.get('listed') !== false)
        .map(d => d.get('creatorId') as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  mappedCache = { at: Date.now(), ids };
  return ids;
}

/** Both mapping lists, for CA Admin → Sales → OnlyMonster mapping. Two collection reads. */
export async function getMapping(): Promise<{ accounts: OnlyMonsterAccountDocument[]; members: OnlyMonsterMemberDocument[] }> {
  const [a, m] = await Promise.all([adminDb.collection(ACCOUNTS).get(), adminDb.collection(MEMBERS).get()]);
  return {
    accounts: a.docs.map(d => d.data() as OnlyMonsterAccountDocument),
    members: m.docs.map(d => d.data() as OnlyMonsterMemberDocument),
  };
}

/**
 * Delete cascade (rule 6): a deleted user can no longer be a manual link
 * target. The automatic match re-resolves on the next directory run.
 */
export async function clearManualMemberLinksForUser(uid: string): Promise<number> {
  const snap = await adminDb.collection(MEMBERS).where('manualUid', '==', uid).get();
  if (snap.empty) return 0;
  const batch = adminDb.batch();
  for (const doc of snap.docs) batch.update(doc.ref, { manualUid: null, uid: null, match: 'none' });
  await batch.commit();
  return snap.size;
}
