#!/usr/bin/env node
/**
 * One-off: join the existing customs to the fan base.
 *
 *   cd src && node scripts/backfill-fan-keys.js            # dry run
 *   cd src && node scripts/backfill-fan-keys.js --commit   # write
 *
 * Every `campaign-tracking` doc gets a `fanKey` derived from its profile link
 * (the OnlyFans id, or `h_<handle>`; `rec=` referral codes are ignored). Then
 * each fan's registry entry (`buddyx-fan-names/{fanKey}`) is recomputed — the
 * name staff use on their customs and the money rollup — and a changed
 * resolved name is written through to the fan's `ca-sales.fanName` and
 * `buddyx-fans` rollups. Idempotent: re-running changes nothing.
 *
 * Prints totals only — no fan names. The dry run reports how many fans' names
 * would change, so a `--commit` holds no surprises.
 *
 * **Plain JS on purpose, like the other scripts here.** The app's own services
 * start with `import 'server-only'`, which only Next supplies, so they cannot
 * run under plain Node. The rules below are therefore a port of
 * `lib/fans/fanIdentity.ts` + `lib/services/fanRegistryService.ts` — if either
 * changes, change this too (it is a one-off; delete it once it has run).
 */
const fs = require('fs');
const path = require('path');

// ── env (same loader as the other scripts) ──
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

const admin = require('firebase-admin');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT env var is required.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const COMMIT = process.argv.includes('--commit');

// ── port of lib/fans/fanIdentity.ts ──
const CAMPAIGN_TYPES = ['BFE', 'Hubby', 'VIP'];
const RESERVED = new Set(['my', 'action', 'login', 'posts', 'search', 'notifications', 'chats', 'lists', 'bookmarks', 'subscriptions', 'settings', 'help', 'terms', 'privacy']);
const HANDLE_RE = /^[a-z0-9_.-]{2,40}$/i;
const ID_RE = /^\d{4,15}$/;
const round2 = n => Math.round(n * 100) / 100;
const isHandleKey = key => key.startsWith('h_');
const cleanName = raw => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** → fan key (`598208266` or `h_handle`), or null when it is not an OnlyFans profile. */
function fanKeyOfLink(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (ID_RE.test(text)) return text;
  let m = text.match(/^u(\d{4,15})$/i);
  if (m) return m[1];
  m = text.match(/^@([a-z0-9_.-]{2,40})$/i);
  if (m) return `h_${m[1].toLowerCase()}`;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'onlyfans.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  m = first.match(/^u(\d{4,15})$/i);
  if (m) return m[1];
  if (first === 'my' && segments[1] === 'chats' && segments[2] === 'chat' && ID_RE.test(segments[3] ?? '')) return segments[3];
  if (!first || RESERVED.has(first.toLowerCase()) || !HANDLE_RE.test(first)) return null;
  return `h_${first.toLowerCase()}`;
}

/** Most used name (case-insensitive, latest spelling); a tie goes to the most recent. */
function pickCustomsName(entries) {
  const tally = new Map();
  for (const { name, at } of entries) {
    const clean = cleanName(name);
    if (!clean) continue;
    const key = clean.toLowerCase();
    const prev = tally.get(key);
    if (!prev) tally.set(key, { count: 1, latestAt: at, spelling: clean });
    else {
      prev.count += 1;
      if (at >= prev.latestAt) {
        prev.latestAt = at;
        prev.spelling = clean;
      }
    }
  }
  let best = null;
  for (const c of tally.values()) {
    if (!best || c.count > best.count || (c.count === best.count && c.latestAt > best.latestAt)) best = c;
  }
  return best ? { name: best.spelling, votes: best.count } : null;
}

/** manual → customs → synced → none. */
function resolveName(doc) {
  if (!doc) return { name: null, source: null };
  if (doc.manualName) return { name: doc.manualName, source: 'manual' };
  if (doc.customsName) return { name: doc.customsName, source: 'customs' };
  if (doc.name) return { name: doc.name, source: doc.source === 'infloww' ? 'infloww' : 'buddyx' };
  return { name: null, source: null };
}

function customMoney(e) {
  const total = Number(e.totalAmount) || 0;
  const paid = Number(e.amountPaid) || 0;
  if (CAMPAIGN_TYPES.includes(e.type)) {
    if (e.isArchived) {
      const before = e.originalAmountPaid;
      return typeof before === 'number' && before < total
        ? { outstanding: 0, abandoned: true, rejected: false }
        : { outstanding: 0, abandoned: false, rejected: false };
    }
    return { outstanding: Math.max(0, round2(total - paid)), abandoned: false, rejected: false };
  }
  if (e.status === 'Rejected') return { outstanding: 0, abandoned: false, rejected: true };
  if (e.status === 'Archived') {
    const before = e.originalTotalAmount;
    return typeof before === 'number'
      ? { outstanding: 0, abandoned: before > paid, rejected: false }
      : { outstanding: 0, abandoned: true, rejected: false };
  }
  return { outstanding: Math.max(0, round2(total - paid)), abandoned: false, rejected: false };
}

// ── main ──
async function main() {
  console.log(COMMIT ? 'COMMIT' : 'DRY RUN');

  // 1. Derive every custom's fan key. A handle that was already linked to an id resolves to the id.
  const snap = await db.collection('campaign-tracking').select('profileLink', 'fanKey').get();
  const handleKeys = [...new Set(snap.docs.map(d => fanKeyOfLink(d.get('profileLink'))).filter(k => k && isHandleKey(k)))];
  const merged = new Map();
  for (let i = 0; i < handleKeys.length; i += 300) {
    for (const s of await db.getAll(...handleKeys.slice(i, i + 300).map(k => db.collection('buddyx-fan-names').doc(k)), { fieldMask: ['mergedInto'] })) {
      if (s.exists && s.get('mergedInto')) merged.set(s.id, s.get('mergedInto'));
    }
  }

  const updates = [];
  const keys = new Set();
  let byId = 0;
  let byHandle = 0;
  let outside = 0;
  for (const doc of snap.docs) {
    let key = fanKeyOfLink(doc.get('profileLink'));
    if (key && merged.has(key)) key = merged.get(key);
    if (!key) outside += 1;
    else if (isHandleKey(key)) byHandle += 1;
    else byId += 1;
    if (key) keys.add(key);
    if ((doc.get('fanKey') ?? null) !== key) updates.push({ ref: doc.ref, key });
  }
  console.log({ customs: snap.size, byId, byHandle, outsideFanBase: outside, fans: keys.size, toUpdate: updates.length });

  if (COMMIT) {
    const writer = db.bulkWriter();
    for (const u of updates) writer.update(u.ref, { fanKey: u.key });
    await writer.close();
    console.log(`fanKey written on ${updates.length} customs`);
  }

  // 2. Recompute each fan's registry entry from its customs. (A dry run reads the
  //    customs as they will be: the keys derived above, not the stored ones.)
  const pending = new Map(updates.map(u => [u.ref.path, u.key]));
  const byKey = new Map();
  const all = await db
    .collection('campaign-tracking')
    .select('fanKey', 'fanName', 'createdTime', 'type', 'status', 'isArchived', 'totalAmount', 'amountPaid', 'originalTotalAmount', 'originalAmountPaid', 'creatorID')
    .get();
  for (const doc of all.docs) {
    const key = pending.has(doc.ref.path) ? pending.get(doc.ref.path) : doc.get('fanKey');
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(doc.data());
  }

  const keyList = [...keys];
  const registry = new Map();
  for (let i = 0; i < keyList.length; i += 300) {
    for (const s of await db.getAll(...keyList.slice(i, i + 300).map(k => db.collection('buddyx-fan-names').doc(k)), { fieldMask: ['name', 'source', 'manualName', 'customsName'] })) {
      if (s.exists) registry.set(s.id, s.data());
    }
  }

  let renamed = 0;
  let salesTouched = 0;
  for (const key of keyList) {
    const rows = byKey.get(key) ?? [];
    const picked = pickCustomsName(rows.map(r => ({ name: r.fanName, at: r.createdTime?.toMillis?.() ?? 0 })));
    const byType = {};
    let outstandingCount = 0;
    let outstandingAmount = 0;
    let abandonedCount = 0;
    let rejectedCount = 0;
    let lastAt = 0;
    const creators = new Set();
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

    const prev = registry.get(key) ?? null;
    const before = resolveName(prev);
    const after = resolveName({ ...(prev ?? {}), customsName: picked?.name ?? null });
    const changed = before.name !== after.name || before.source !== after.source;
    if (changed) renamed += 1;
    if (!COMMIT) continue;

    await db.collection('buddyx-fan-names').doc(key).set(
      {
        ...(prev ? {} : isHandleKey(key) ? { fanId: null, handle: key.slice(2) } : { fanId: key }),
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

    // Write the resolved name through (a handle-only fan has no sales or rollup).
    if (!changed || isHandleKey(key)) continue;
    const override = after.source === 'manual' || after.source === 'customs' ? after.name : null;
    const [fans, sales] = await Promise.all([
      db.collection('buddyx-fans').where('fanId', '==', key).select('displayName', 'displayNameSource', 'salesName').get(),
      db.collection('ca-sales').where('fanId', '==', key).select('fanName').get(),
    ]);
    const writer = db.bulkWriter();
    for (const doc of fans.docs) {
      writer.update(
        doc.ref,
        override
          ? { displayName: override, displayNameSource: after.source, salesName: after.name }
          : { displayName: FieldValue.delete(), displayNameSource: FieldValue.delete(), salesName: after.name ?? FieldValue.delete() },
      );
    }
    for (const doc of sales.docs) {
      if ((doc.get('fanName') ?? '') !== (after.name ?? '')) {
        writer.update(doc.ref, { fanName: after.name ?? '' });
        salesTouched += 1;
      }
    }
    await writer.close();
  }

  console.log(COMMIT
    ? { fansRefreshed: keyList.length, namesChanged: renamed, salesRenamed: salesTouched }
    : { fansToRefresh: keyList.length, namesThatWouldChange: renamed });
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  },
);
