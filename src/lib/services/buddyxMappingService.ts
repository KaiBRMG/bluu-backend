/**
 * BuddyX identity mapping — the `directory` scope, and the admin's manual links.
 *
 * Two collections, both keyed by the BuddyX id and both rewritten only when
 * something in them changed (rule 9):
 *
 * - `buddyx-chatters/{chatterId}` → the Bluu user, by email (`mapping.ts`).
 * - `buddyx-models/{modelId}` → the creator or sub-account, by handle.
 *
 * An admin's manual link wins over the automatic match and survives every
 * later sync. Re-mapping does not touch `ca-sales` here: the next `sales` run
 * re-derives every open-window row from the new map, and its fingerprint
 * (`syncHash`) changes, so exactly the affected rows are re-stamped. Rows in a
 * finalised month are refused by the same guard as any other change.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { normalizeEmail } from '../authEmail';
import { buddyxData } from '../buddyx/client';
import {
  buildEmailIndex,
  buildHandleIndex,
  resolveChatter,
  resolveModel,
  type CreatorForMatch,
} from '../buddyx/mapping';
import { normaliseId, type BuddyxCreator, type BuddyxTeamMember } from '../buddyx/types';
import type { ChatterRef, ModelRef } from '../buddyx/salesPlan';
import type { BuddyxChatterDocument, BuddyxModelDocument } from '@/types/firestore';

export const CHATTERS = 'buddyx-chatters';
export const MODELS = 'buddyx-models';

export interface BuddyxMaps {
  chatters: Map<string, ChatterRef>;
  models: Map<string, ModelRef>;
  /** modelId → creatorId, mapped models only. */
  modelCreator: Map<string, string>;
  /** uid → chatterId, for the analytics joins. */
  uidChatter: Map<string, string>;
}

function mapsFrom(chatters: BuddyxChatterDocument[], models: BuddyxModelDocument[]): BuddyxMaps {
  const maps: BuddyxMaps = { chatters: new Map(), models: new Map(), modelCreator: new Map(), uidChatter: new Map() };
  for (const c of chatters) {
    maps.chatters.set(c.chatterId, { uid: c.uid, email: c.email, name: c.name });
    if (c.uid) maps.uidChatter.set(c.uid, c.chatterId);
  }
  for (const m of models) {
    maps.models.set(m.modelId, { creatorId: m.creatorId, creatorName: m.creatorName, handle: m.handle });
    if (m.creatorId) maps.modelCreator.set(m.modelId, m.creatorId);
  }
  return maps;
}

let mappedCache: { at: number; ids: string[] } | null = null;

/**
 * Every creator / sub-account a BuddyX model is mapped to. Field-masked and
 * cached 60s per instance — the dispute picker, Fan Analytics and OnlyFans
 * Analytics all ask, and the map changes a few times a year.
 */
export async function mappedCreatorIds(): Promise<string[]> {
  if (mappedCache && Date.now() - mappedCache.at < 60_000) return mappedCache.ids;
  const snap = await adminDb.collection(MODELS).select('creatorId').get();
  const ids = [...new Set(snap.docs.map(d => d.get('creatorId') as string | null).filter((v): v is string => Boolean(v)))];
  mappedCache = { at: Date.now(), ids };
  return ids;
}

/** The stored maps, without calling BuddyX. Used when the directory call fails, and by the read side. */
export async function loadBuddyxMaps(): Promise<BuddyxMaps> {
  const [chatterSnap, modelSnap] = await Promise.all([
    adminDb.collection(CHATTERS).get(),
    adminDb.collection(MODELS).get(),
  ]);
  return mapsFrom(
    chatterSnap.docs.map(d => d.data() as BuddyxChatterDocument),
    modelSnap.docs.map(d => d.data() as BuddyxModelDocument),
  );
}

interface RosterUser {
  uid: string;
  workEmail: string;
  displayName: string;
}

async function readRoster(): Promise<{ users: RosterUser[]; creators: CreatorForMatch[] }> {
  // Field-masked: three small reads for the whole matching pass. Archived users
  // and creators are kept on purpose — historical pay must still resolve.
  const [usersSnap, creatorsSnap, subsSnap] = await Promise.all([
    adminDb.collection('users').select('uid', 'workEmail', 'displayName').get(),
    adminDb.collection('creators').select('creatorID', 'stageName', 'OFID').get(),
    adminDb.collection('creator-subaccounts').select('stageName', 'OFID').get(),
  ]);

  const users = usersSnap.docs.map(d => ({
    uid: (d.get('uid') as string | undefined) ?? d.id,
    workEmail: (d.get('workEmail') as string | undefined) ?? '',
    displayName: (d.get('displayName') as string | undefined) ?? '',
  }));
  const creators: CreatorForMatch[] = [
    ...creatorsSnap.docs.map(d => ({
      id: (d.get('creatorID') as string | undefined) ?? d.id,
      stageName: (d.get('stageName') as string | undefined) ?? '',
      OFID: (d.get('OFID') as string | undefined) ?? null,
    })),
    ...subsSnap.docs.map(d => ({
      id: d.id,
      stageName: (d.get('stageName') as string | undefined) ?? '',
      OFID: (d.get('OFID') as string | undefined) ?? null,
    })),
  ];
  return { users, creators };
}

/** True when two plain records differ on any of the named keys. */
function differs<T extends object>(a: T | undefined, b: T, keys: (keyof T)[]): boolean {
  if (!a) return true;
  return keys.some(k => (a[k] ?? null) !== (b[k] ?? null));
}

export interface DirectoryResult {
  maps: BuddyxMaps;
  counts: { chatters: number; chattersMapped: number; models: number; modelsMapped: number; written: number };
}

/**
 * The `directory` scope: `/team-members` + `/creators`, matched against the
 * roster, written where changed. Two BuddyX requests.
 */
export async function syncDirectory(): Promise<DirectoryResult> {
  const [members, creators, roster, chatterSnap, modelSnap] = await Promise.all([
    buddyxData<BuddyxTeamMember[]>('/v1/public/team-members'),
    buddyxData<BuddyxCreator[]>('/v1/public/creators'),
    readRoster(),
    adminDb.collection(CHATTERS).get(),
    adminDb.collection(MODELS).get(),
  ]);

  const storedChatters = new Map(chatterSnap.docs.map(d => [d.id, d.data() as BuddyxChatterDocument]));
  const storedModels = new Map(modelSnap.docs.map(d => [d.id, d.data() as BuddyxModelDocument]));

  const emailIndex = buildEmailIndex(roster.users, normalizeEmail);
  const knownUids = new Set(roster.users.map(u => u.uid));
  const handleIndex = buildHandleIndex(roster.creators);
  const creatorsById = new Map(roster.creators.map(c => [c.id, c]));

  const batch = adminDb.batch();
  let written = 0;
  const chatters: BuddyxChatterDocument[] = [];
  const models: BuddyxModelDocument[] = [];
  const now = Timestamp.now();

  for (const member of members ?? []) {
    const chatterId = normaliseId(member.id);
    if (!chatterId) continue;
    const prev = storedChatters.get(chatterId);
    const { uid, match } = resolveChatter(
      { email: member.email, manualUid: prev?.manualUid ?? null },
      emailIndex,
      normalizeEmail,
      knownUids,
    );
    const next: BuddyxChatterDocument = {
      chatterId,
      name: member.name ?? null,
      email: member.email ?? null,
      status: member.status ?? null,
      timeZone: member.timeZone ?? null,
      uid,
      match,
      manualUid: prev?.manualUid ?? null,
      linkedBy: prev?.linkedBy ?? null,
      linkedAt: prev?.linkedAt ?? null,
      unmappedAlertedAt: uid ? null : (prev?.unmappedAlertedAt ?? null),
      syncedAt: now,
    };
    chatters.push(next);
    if (differs(prev, next, ['name', 'email', 'status', 'timeZone', 'uid', 'match', 'unmappedAlertedAt'])) {
      batch.set(adminDb.collection(CHATTERS).doc(chatterId), next, { merge: true });
      written += 1;
    }
  }
  // A chatter BuddyX no longer lists still owns historical rows — keep its doc.
  for (const [id, prev] of storedChatters) if (!chatters.some(c => c.chatterId === id)) chatters.push(prev);

  for (const creator of creators ?? []) {
    const modelId = normaliseId(creator.id);
    if (!modelId) continue;
    const prev = storedModels.get(modelId);
    const resolved = resolveModel(
      { handle: creator.handle, manualCreatorId: prev?.manualCreatorId ?? null },
      handleIndex,
      creatorsById,
    );
    const next: BuddyxModelDocument = {
      modelId,
      handle: creator.handle ?? null,
      customName: creator.customName ?? null,
      revShare: creator.revShare ?? null,
      creatorId: resolved.creatorId,
      creatorName: resolved.creatorName,
      match: resolved.match,
      manualCreatorId: prev?.manualCreatorId ?? null,
      linkedBy: prev?.linkedBy ?? null,
      linkedAt: prev?.linkedAt ?? null,
      syncedAt: now,
    };
    models.push(next);
    if (differs(prev, next, ['handle', 'customName', 'revShare', 'creatorId', 'creatorName', 'match'])) {
      batch.set(adminDb.collection(MODELS).doc(modelId), next, { merge: true });
      written += 1;
    }
  }
  for (const [id, prev] of storedModels) if (!models.some(m => m.modelId === id)) models.push(prev);

  if (written > 0) await batch.commit();

  return {
    maps: mapsFrom(chatters, models),
    counts: {
      chatters: chatters.length,
      chattersMapped: chatters.filter(c => c.uid).length,
      models: models.length,
      modelsMapped: models.filter(m => m.creatorId).length,
      written,
    },
  };
}

/**
 * An admin's manual link. `null` clears it, and the next directory run falls
 * back to the automatic match. Resolves immediately so the mapping screen shows
 * the result without waiting for a sync.
 */
export async function setManualChatterLink(chatterId: string, uid: string | null, actorUid: string): Promise<void> {
  const ref = adminDb.collection(CHATTERS).doc(chatterId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Unknown BuddyX chatter');

  if (uid) {
    const user = await adminDb.collection('users').doc(uid).get();
    if (!user.exists) throw new Error('Unknown user');
    await ref.update({ manualUid: uid, uid, match: 'manual', linkedBy: actorUid, linkedAt: FieldValue.serverTimestamp() });
    return;
  }

  const data = snap.data() as BuddyxChatterDocument;
  const roster = await readRoster();
  const { uid: resolved, match } = resolveChatter(
    { email: data.email, manualUid: null },
    buildEmailIndex(roster.users, normalizeEmail),
    normalizeEmail,
  );
  await ref.update({ manualUid: null, uid: resolved, match, linkedBy: actorUid, linkedAt: FieldValue.serverTimestamp() });
}

export async function setManualModelLink(modelId: string, creatorId: string | null, actorUid: string): Promise<void> {
  const ref = adminDb.collection(MODELS).doc(modelId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Unknown BuddyX creator');

  const roster = await readRoster();
  const creatorsById = new Map(roster.creators.map(c => [c.id, c]));
  if (creatorId && !creatorsById.has(creatorId)) throw new Error('Unknown creator');

  const data = snap.data() as BuddyxModelDocument;
  const resolved = resolveModel(
    { handle: data.handle, manualCreatorId: creatorId },
    buildHandleIndex(roster.creators),
    creatorsById,
  );
  await ref.update({
    manualCreatorId: creatorId,
    creatorId: resolved.creatorId,
    creatorName: resolved.creatorName,
    match: resolved.match,
    linkedBy: actorUid,
    linkedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Delete cascade (rule 6): a deleted user can no longer be a manual link
 * target. The automatic match re-resolves on the next directory run.
 */
export async function clearManualLinksForUser(uid: string): Promise<number> {
  const snap = await adminDb.collection(CHATTERS).where('manualUid', '==', uid).get();
  if (snap.empty) return 0;
  const batch = adminDb.batch();
  for (const doc of snap.docs) batch.update(doc.ref, { manualUid: null, uid: null, match: 'none' });
  await batch.commit();
  return snap.size;
}
