/**
 * The fan registry — `buddyx-fan-names/{fanKey}` — and the writes that keep a
 * fan's name the same on every surface.
 *
 * Three owners write one document, each its own fields (`FanRegistryDocument`):
 * the BuddyX/Infloww sync owns `name`/`source`, staff own `manualName`, and the
 * fan's customs own the `customs*` rollup. Resolution is `resolveFanName`.
 *
 * **A name change is written through, not resolved on read.** Sales and the
 * analytics rollups carry the fan's name (`ca-sales.fanName`,
 * `buddyx-fans.displayName`) so a ledger of hundreds of rows costs no registry
 * reads; a rename is rare, so the rename pays instead — one query per
 * collection for that one fan.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { round2 } from '../salary/salaryEngine';
import {
  cleanFanName,
  customMoney,
  fanKeyOf,
  isHandleKey,
  parseProfileLink,
  pickCustomsName,
  resolveFanName,
  type CustomMoneyFields,
  type FanNameSource,
} from '../fans/fanIdentity';
import type { FanRegistryDocument } from '@/types/firestore';

export const FAN_REGISTRY = 'buddyx-fan-names';
const CUSTOMS = 'campaign-tracking';

const registry = (key: string) => adminDb.collection(FAN_REGISTRY).doc(key);

/**
 * The registry key a custom's profile link belongs to — a handle entry that
 * has since been linked to an id resolves to the id. `null` for a link that is
 * not an OnlyFans profile (the custom then stays outside the fan base).
 */
export async function resolveFanKeyForLink(profileLink: string | null | undefined): Promise<string | null> {
  const key = fanKeyOf(parseProfileLink(profileLink));
  if (!key || !isHandleKey(key)) return key;
  const snap = await registry(key).get();
  return (snap.exists && (snap.get('mergedInto') as string | null)) || key;
}

/** Names for a set of fan ids, resolved (manual → customs → synced). Ids without one are absent. */
export async function resolvedFanNames(fanIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, fields] of await readNameFields([...new Set(fanIds.filter(Boolean))])) {
    const { name } = resolveFanName(fields);
    if (name) out.set(id, name);
  }
  return out;
}

// ─── Customs fans (the directory's and the wizard's source) ──────────

const CUSTOMS_FANS_TTL_MS = 60_000;
let customsFansCache: { at: number; value: Array<FanRegistryDocument & { key: string }> } | null = null;

/**
 * Every registry entry with at least one custom — small (one per fan who ever
 * ordered one). Cached 60s per instance and dropped by every registry write
 * here, so the instance that made a change reads it back at once.
 */
export async function readCustomsFans(): Promise<Array<FanRegistryDocument & { key: string }>> {
  if (customsFansCache && Date.now() - customsFansCache.at < CUSTOMS_FANS_TTL_MS) return customsFansCache.value;
  const snap = await adminDb
    .collection(FAN_REGISTRY)
    .where('customsCount', '>', 0)
    .select(
      'fanId', 'handle', 'name', 'source', 'manualName', 'customsName', 'customsCount',
      'customsOutstandingAmount', 'customsCreatorIds', 'lastCustomAt',
    )
    .get();
  const value = snap.docs.map(d => ({ ...(d.data() as FanRegistryDocument), key: d.id }));
  customsFansCache = { at: Date.now(), value };
  return value;
}

type CustomRow = CustomMoneyFields & { fanName?: string; creatorID?: string; createdTime?: Timestamp };

/**
 * Recompute the customs half of each fan's entry — the name staff use and the
 * money rollup — from the fan's customs, and write the name through if the
 * resolved name moved. Called by every route that creates, edits or deletes a
 * custom. One query per key; customs per fan are a handful.
 */
export async function refreshFanCustoms(keys: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  if (unique.length === 0) return;
  const before = await readNameFields(unique);
  await Promise.all(unique.map(key => refreshOne(key, before.get(key) ?? null)));
  customsFansCache = null;
}

/**
 * `refreshFanCustoms` for a route that has already written the custom: it
 * never fails the request (the custom exists either way, and the next edit to
 * any of the fan's customs recomputes it). Run it in `after()`.
 */
export async function refreshFanCustomsQuietly(keys: Array<string | null | undefined>, context: string): Promise<void> {
  try {
    await refreshFanCustoms(keys);
  } catch (err) {
    console.error(`[${context}] fan registry refresh failed`, err);
  }
}

async function refreshOne(key: string, prev: NameFields | null): Promise<void> {
  const snap = await adminDb
    .collection(CUSTOMS)
    .where('fanKey', '==', key)
    .select('fanName', 'createdTime', 'type', 'status', 'isArchived', 'totalAmount', 'amountPaid', 'originalTotalAmount', 'originalAmountPaid', 'creatorID')
    .get();
  const rows = snap.docs.map(d => d.data() as CustomRow);

  const picked = pickCustomsName(rows.map(r => ({ name: r.fanName, at: r.createdTime?.toMillis?.() ?? 0 })));
  const byType: Record<string, number> = {};
  let outstandingCount = 0;
  let outstandingAmount = 0;
  let abandonedCount = 0;
  let rejectedCount = 0;
  let lastAt = 0;
  const creators = new Set<string>();
  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    const money = customMoney(row);
    if (money.outstanding > 0) {
      outstandingCount += 1;
      outstandingAmount += money.outstanding;
    }
    if (money.abandoned) abandonedCount += 1;
    if (money.rejected) rejectedCount += 1;
    if (row.creatorID) creators.add(row.creatorID);
    lastAt = Math.max(lastAt, row.createdTime?.toMillis?.() ?? 0);
  }

  await registry(key).set(
    {
      ...identityFields(key, prev),
      customsName: picked?.name ?? null,
      customsNameVotes: picked?.votes ?? 0,
      customsCount: rows.length,
      customsByType: byType,
      customsOutstandingCount: outstandingCount,
      customsOutstandingAmount: round2(outstandingAmount),
      customsAbandonedCount: abandonedCount,
      customsRejectedCount: rejectedCount,
      customsCreatorIds: [...creators],
      lastCustomAt: lastAt ? Timestamp.fromMillis(lastAt) : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await propagateIfChanged(key, prev, { ...(prev ?? {}), customsName: picked?.name ?? null });
}

/**
 * Set (or, with `null`, clear) the name staff chose for a fan. A manual name
 * outranks everything and nothing automatic replaces it.
 */
export async function setManualFanName(
  key: string,
  rawName: string | null,
  actor: { uid: string; name: string },
): Promise<void> {
  const name = rawName === null ? null : cleanFanName(rawName);
  if (rawName !== null && !name) throw new Error('A name cannot be blank.');
  const prev = (await readNameFields([key])).get(key) ?? null;
  await registry(key).set(
    {
      ...identityFields(key, prev),
      manualName: name,
      manualNameBy: name ? actor.uid : null,
      manualNameByName: name ? actor.name : null,
      manualNameAt: name ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await propagateIfChanged(key, prev, { ...(prev ?? {}), manualName: name });
  customsFansCache = null;
}

/**
 * Link a handle-only fan (`h_<handle>`) to their OnlyFans id: their customs
 * move to the id, the handle entry is kept as an alias (`mergedInto`) so a
 * later custom pasted with the same handle link lands on the id too, and a
 * manual name moves with them unless the id already has one.
 */
export async function linkHandleFan(handleKey: string, fanId: string, actorUid: string): Promise<void> {
  if (!isHandleKey(handleKey)) throw new Error('Only a fan known by handle can be linked.');
  const [handleSnap, idSnap] = await adminDb.getAll(registry(handleKey), registry(fanId));
  if (!handleSnap.exists) throw new Error('Fan not found.');
  const handleDoc = handleSnap.data() as FanRegistryDocument;
  if (handleDoc.mergedInto) throw new Error('This fan is already linked.');
  const idDoc = (idSnap.exists ? idSnap.data() : null) as FanRegistryDocument | null;

  const customs = await adminDb.collection(CUSTOMS).where('fanKey', '==', handleKey).select().get();
  const writer = adminDb.bulkWriter();
  for (const doc of customs.docs) writer.update(doc.ref, { fanKey: fanId });
  writer.set(
    registry(fanId),
    {
      fanId,
      handles: FieldValue.arrayUnion(handleKey.slice(2)),
      ...(handleDoc.manualName && !idDoc?.manualName
        ? {
            manualName: handleDoc.manualName,
            manualNameBy: handleDoc.manualNameBy ?? null,
            manualNameByName: handleDoc.manualNameByName ?? null,
            manualNameAt: handleDoc.manualNameAt ?? null,
          }
        : {}),
      linkedBy: actorUid,
      linkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  writer.set(
    registry(handleKey),
    { mergedInto: fanId, customsCount: 0, linkedBy: actorUid, linkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await writer.close();
  await refreshFanCustoms([fanId]);
}

// ─── internals ───────────────────────────────────────────────────────

type NameFields = Partial<Pick<FanRegistryDocument, 'fanId' | 'handle' | 'name' | 'source' | 'manualName' | 'customsName'>>;

async function readNameFields(keys: string[]): Promise<Map<string, NameFields>> {
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 300) chunks.push(keys.slice(i, i + 300));
  const snaps = await Promise.all(chunks.map(chunk =>
    adminDb.getAll(...chunk.map(k => registry(k)), { fieldMask: ['fanId', 'handle', 'name', 'source', 'manualName', 'customsName'] }),
  ));
  const out = new Map<string, NameFields>();
  for (const snap of snaps.flat()) if (snap.exists) out.set(snap.id, snap.data() as NameFields);
  return out;
}

/** `fanId` / `handle` for a new entry; an existing one keeps what it has. */
function identityFields(key: string, prev: NameFields | null): Record<string, unknown> {
  if (prev) return {};
  return isHandleKey(key) ? { fanId: null, handle: key.slice(2) } : { fanId: key };
}

async function propagateIfChanged(key: string, prev: NameFields | null, next: NameFields): Promise<void> {
  const a = resolveFanName(prev);
  const b = resolveFanName(next);
  if (a.name === b.name && a.source === b.source) return;
  // A handle-only fan has no sales and no BuddyX rollup to update.
  if (isHandleKey(key)) return;
  await writeNameThrough(key, b.name, b.source);
}

/**
 * Put the resolved name on the fan's sales and analytics rollups. Sales take
 * the full resolved name; the rollup takes only a manual/customs name (it
 * already holds the synced one in `name`), and loses it when that is gone.
 */
async function writeNameThrough(fanId: string, name: string | null, source: FanNameSource | null): Promise<void> {
  const override = source === 'manual' || source === 'customs' ? name : null;
  const [fans, sales] = await Promise.all([
    adminDb.collection('buddyx-fans').where('fanId', '==', fanId).select('displayName', 'displayNameSource', 'salesName').get(),
    adminDb.collection('ca-sales').where('fanId', '==', fanId).select('fanName').get(),
  ]);
  const writer = adminDb.bulkWriter();
  for (const doc of fans.docs) {
    const same =
      (doc.get('displayName') ?? null) === override &&
      (doc.get('displayNameSource') ?? null) === (override ? source : null) &&
      (doc.get('salesName') ?? null) === name;
    if (same) continue;
    // `salesName` is rebuilt from the sales' names, so it follows them here —
    // otherwise a reverted manual name would survive in it.
    writer.update(doc.ref, override
      ? { displayName: override, displayNameSource: source, salesName: name }
      : { displayName: FieldValue.delete(), displayNameSource: FieldValue.delete(), salesName: name ?? FieldValue.delete() });
  }
  for (const doc of sales.docs) {
    if ((doc.get('fanName') ?? '') !== (name ?? '')) writer.update(doc.ref, { fanName: name ?? '' });
  }
  await writer.close();
}
