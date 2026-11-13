#!/usr/bin/env node
/**
 * OnlyMonster Phase 0 probe — closes the V-items in onlymonster-migration.md §11.
 *
 *   cd src && node scripts/onlymonster-probe.js                       # directory only (accounts + members)
 *   cd src && node scripts/onlymonster-probe.js --account 123 --day 2026-11-03
 *   cd src && node scripts/onlymonster-probe.js --account 123 --day 2026-11-03 --history --volume
 *   cd src && node scripts/onlymonster-probe.js --compare-bluu        # V8/V9, reads Firestore (read-only)
 *
 * THE USER RUNS THIS. Claude never calls the OnlyMonster API (CLAUDE.md rule 9b's
 * pattern): paste the output back and the V-items get answered from it.
 *
 * Safety, enforced in code rather than by convention:
 *   - GET only. `get()` is the single place a request is made and it hard-codes the
 *     method; there is no code path that can send anything else.
 *   - Path allowlist. Only the read endpoints the V-items need. In particular NO chat
 *     endpoint is reachable (reading a chat marks it read on OnlyFans) and no
 *     /proxy/ endpoint (payout reads need a different key and are Phase 7).
 *   - A hard call budget (--max-calls, default 150) and ≥ 120 ms between calls.
 *   - Fan ids are hashed in the output (salted per run, so they cannot be reversed
 *     by guessing, and the same fan keeps the same tag within one run).
 *   - The API key is read from ONLYMONSTER_API_KEY (src/.env.local or the shell) and
 *     never printed.
 *
 * Flags
 *   --account <omId>     OnlyMonster account id (the `id` from /accounts) to probe.
 *   --day YYYY-MM-DD     the day to probe, on the Africa/Harare calendar (default: yesterday).
 *   --history            V6: earliest month with transactions, per --account.
 *   --volume             V10: transaction count by month for the last 3 full months.
 *   --compare-bluu       V8/V9: match members↔users and accounts↔creators (Firestore read-only).
 *   --coverage           V6: one call per OnlyFans account, does history reach before 2025-10-04?
 *   --months 2026-10,2026-11   V13: with --compare-bluu, the open payroll months to check for bx-* sales.
 *   --save-snapshot <file>     V4: save this day's transaction ids/statuses/amounts.
 *   --compare-snapshot <file>  V4: re-run HOURS LATER (so some `loading` rows have settled) and diff against
 *                              the snapshot: same id with a new status, vanished ids, or re-keyed ids.
 *   --out <file>         also write the full report as JSON (still hashed).
 *   --max-calls <n>      call budget (default 150).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── env ─────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = name => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const BASE = 'https://omapi.onlymonster.ai';
const KEY = process.env.ONLYMONSTER_API_KEY;
if (!KEY) fail('ONLYMONSTER_API_KEY is not set (src/.env.local or the shell). Create a READ-ONLY key — see plan §4.3.');

const MAX_CALLS = Number(opt('max-calls') ?? 150);
const ACCOUNT = opt('account');
const OUT = opt('out');
const SALT = crypto.randomBytes(8).toString('hex');

// ── the one place a request is made ─────────────────────────────────────────
// Allowlist of read endpoints. Anything else throws before the network is touched.
const ALLOWED = [
  /^\/api\/v0\/accounts$/,
  /^\/api\/v0\/members$/,
  /^\/api\/v0\/users\/metrics$/,
  /^\/api\/v0\/platforms\/onlyfans\/accounts\/\d+\/transactions$/,
  /^\/api\/v0\/platforms\/onlyfans\/accounts\/\d+\/chargebacks$/,
  /^\/api\/v0\/platforms\/onlyfans\/accounts\/\d+\/overview-metrics$/,
  /^\/api\/v0\/accounts\/\d+\/mass-messages$/,
];

let calls = 0;
let lastCallAt = 0;
const callLog = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(pathname, params = {}) {
  if (!ALLOWED.some(re => re.test(pathname))) throw new Error(`Refusing: ${pathname} is not on the probe allowlist`);
  if (calls >= MAX_CALLS) throw new Error(`Call budget (${MAX_CALLS}) exhausted — raise --max-calls if intended`);

  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, String(x)));
    else url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = 120 - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    calls++;

    const res = await fetch(url, { method: 'GET', headers: { 'x-om-auth-token': KEY, accept: 'application/json' } });
    callLog.push(`${res.status} ${pathname}`);
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? 1);
      await sleep(Math.min(Math.max(ra, 1), 10) * 1000);
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text.slice(0, 300) };
    }
    if (!res.ok) {
      const err = new Error(`${res.status} ${pathname} ${JSON.stringify(body).slice(0, 300)}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }
  throw new Error(`429 persisted on ${pathname}`);
}

// ── helpers ─────────────────────────────────────────────────────────────────
const hashFan = id => 'fan_' + crypto.createHash('sha256').update(SALT + String(id)).digest('hex').slice(0, 8);
const round2 = n => Math.round(n * 100) / 100;
const tally = (arr, keyFn) => {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};
const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));

const report = { generatedAt: new Date().toISOString(), salt: 'per-run', notes: [] };
const section = title => console.log(`\n━━ ${title} ${'━'.repeat(Math.max(0, 70 - title.length))}`);
const show = (label, value) => console.log(`  ${label}`, value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2).replace(/\n/g, '\n  '));

// Africa/Harare is UTC+2 with no DST — same assumption as salaryDate.ts.
const HARARE = '+02:00';
function dayBounds(day) {
  const start = new Date(`${day}T00:00:00${HARARE}`);
  const end = new Date(`${day}T23:59:59.999${HARARE}`);
  if (Number.isNaN(start.getTime())) fail(`Bad --day "${day}" (want YYYY-MM-DD)`);
  return { start, end };
}
function defaultDay() {
  const now = new Date(Date.now() + 2 * 3600 * 1000 - 24 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

async function paginate(pathname, params, { itemsKey = 'items', cursorKey = 'cursor', maxPages = 20 } = {}) {
  const items = [];
  let cursor;
  let pages = 0;
  let complete = true;
  do {
    const body = await get(pathname, { ...params, cursor });
    items.push(...(body[itemsKey] ?? []));
    cursor = body[cursorKey];
    pages++;
    if (pages >= maxPages && cursor) {
      complete = false;
      break;
    }
  } while (cursor);
  return { items, pages, complete };
}

// ── 1. directory: V9, V12 ───────────────────────────────────────────────────
async function probeDirectory() {
  section('Directory — accounts (V9, V12) and members (V8)');

  const acc = await paginate('/api/v0/accounts', { limit: 1000, withExpiredSubscriptions: true }, { itemsKey: 'accounts', cursorKey: 'nextCursor' });
  const noExpired = await get('/api/v0/accounts', { limit: 1000 });
  report.accounts = acc.items.map(a => ({
    id: a.id,
    platform: a.platform,
    username: a.username,
    name: a.name,
    custom_label: a.custom_label,
    platform_account_id: a.platform_account_id,
    expires: a.subscription_expiration_date,
  }));
  show(`accounts (withExpiredSubscriptions=true): ${acc.items.length}   (without the flag: ${(noExpired.accounts ?? []).length})`);
  show('by platform:', tally(acc.items, a => a.platform));
  for (const a of report.accounts) {
    console.log(`   ${String(a.id).padStart(7)}  ${a.platform.padEnd(9)} @${a.username}  ${a.custom_label ? `[${a.custom_label}] ` : ''}platform_id=${a.platform_account_id}  expires=${a.expires ?? '—'}`);
  }
  report.notes.push('V12: compare the two counts above — the difference is the expired-subscription accounts only the flag returns.');

  const members = [];
  for (let offset = 0; ; offset += 50) {
    const body = await get('/api/v0/members', { limit: 50, offset });
    const page = body?.users ?? body?.members ?? body?.items ?? body?.data ?? [];
    if (offset === 0 && page.length === 0) {
      // The first run got 0 members while /users/metrics returned 7 user ids. Show the shape
      // (keys and array lengths only, no personal data) so we can see whether the key is wrong
      // or the list is really empty.
      const shape = body && typeof body === 'object' ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v])) : String(body);
      show('V8  /members returned no rows. Response shape:', shape);
    }
    members.push(...page);
    if (page.length < 50) break;
    if (offset > 1000) break;
  }
  report.members = members.map(m => ({ id: m.id, name: m.name, email: m.email, customName: m.customName }));
  show(`members: ${members.length}`);
  for (const m of report.members) console.log(`   ${String(m.id).padStart(7)}  ${m.email}  (${m.customName ?? m.name})`);
  return { accounts: acc.items, members };
}

// ── 2. transactions for one account-day: V1 V2 V3 V4 ────────────────────────
async function probeTransactions(account, day) {
  section(`Transactions — account ${account.id} @${account.username}, ${day} (Harare day) (V1–V4)`);
  const { start, end } = dayBounds(day);
  const pid = account.platform_account_id;
  const base = `/api/v0/platforms/onlyfans/accounts/${pid}/transactions`;

  const big = await paginate(base, { start: start.toISOString(), end: end.toISOString(), limit: 1000 });
  const tx = big.items;
  show(`fetched ${tx.length} in ${big.pages} page(s) at limit=1000, complete=${big.complete}`);
  if (tx.length === 0) {
    show('No transactions that day — pick a busier --day.');
    return { tx, start, end, pid };
  }

  // V1/V3/V4 — the strings and the nulls, exactly as sent.
  show('V1  type strings :', tally(tx, t => t.type));
  show('V4  status values:', tally(tx, t => t.status));
  show('V3  amount null  :', `${tx.filter(t => t.amount === null || t.amount === undefined).length} of ${tx.length}`);
  show('V3  amount by type (n, gross sum):', Object.fromEntries(Object.entries(tally(tx, t => t.type)).map(([k, n]) => [k, [n, sum(tx.filter(t => t.type === k), t => t.amount)]])));
  show('V3  amount decimal places seen:', tally(tx.filter(t => t.amount != null), t => (String(t.amount).split('.')[1] ?? '').length));

  // V2 — timestamp precision and ordering.
  show('V2  timestamp samples:', tx.slice(0, 3).map(t => t.timestamp));
  show('V2  timestamp shapes :', tally(tx, t => t.timestamp.replace(/\d/g, 'd')));
  const sortedDesc = tx.every((t, i) => i === 0 || tx[i - 1].timestamp >= t.timestamp);
  show('V2  newest-first order holds:', String(sortedDesc));
  show('V2  duplicate ids in one pull:', String(tx.length - new Set(tx.map(t => t.id)).size));

  // V2 — is the cursor stable? Page the same window at limit=10 and compare id sets.
  const small = await paginate(base, { start: start.toISOString(), end: end.toISOString(), limit: 10 }, { maxPages: 60 });
  const a = new Set(tx.map(t => t.id));
  const b = new Set(small.items.map(t => t.id));
  show('V2  limit=10 paging vs limit=1000:', {
    pagesAtLimit10: small.pages,
    complete: small.complete,
    countsEqual: a.size === b.size,
    missingFromSmall: [...a].filter(x => !b.has(x)).length,
    extraInSmall: [...b].filter(x => !a.has(x)).length,
    duplicatesInSmall: small.items.length - b.size,
  });

  // V2 — are start/end inclusive? Re-query a window that begins / ends exactly on a known timestamp.
  const pivot = tx[Math.floor(tx.length / 2)];
  const exact = new Date(pivot.timestamp);
  const atStart = await get(base, { start: exact.toISOString(), end: end.toISOString(), limit: 1000 });
  const atEnd = await get(base, { start: start.toISOString(), end: exact.toISOString(), limit: 1000 });
  show('V2  start == tx.timestamp includes that tx:', String((atStart.items ?? []).some(t => t.id === pivot.id)));
  show('V2  end   == tx.timestamp includes that tx:', String((atEnd.items ?? []).some(t => t.id === pivot.id)));

  // Fan ids are hashed; the amounts/types are what the V-items need.
  report.transactions = tx.map(t => ({ id: t.id, fan: hashFan(t.fan?.id), type: t.type, status: t.status, amount: t.amount, timestamp: t.timestamp }));
  console.log('\n  first 8 rows (fan ids hashed):');
  for (const t of report.transactions.slice(0, 8)) console.log(`   ${t.timestamp}  ${String(t.amount).padStart(8)}  ${t.status.padEnd(14)} ${t.type}  ${t.fan}  id=${t.id}`);

  // V4 — a snapshot to diff on a later run, to see loading→done id behaviour.
  const snapFile = opt('save-snapshot');
  if (snapFile) {
    fs.writeFileSync(snapFile, JSON.stringify(tx.map(t => ({ id: t.id, status: t.status, amount: t.amount, timestamp: t.timestamp }))));
    show(`V4  snapshot saved to ${snapFile} — re-run later with --compare-snapshot ${snapFile}`);
  }
  const cmpFile = opt('compare-snapshot');
  if (cmpFile) {
    const old = JSON.parse(fs.readFileSync(cmpFile, 'utf8'));
    const nowById = new Map(tx.map(t => [t.id, t]));
    const oldById = new Map(old.map(t => [t.id, t]));
    const changed = old.filter(o => nowById.has(o.id) && (nowById.get(o.id).status !== o.status || nowById.get(o.id).amount !== o.amount));
    const gone = old.filter(o => !nowById.has(o.id));
    const fresh = tx.filter(t => !oldById.has(t.id));
    show('V4  vs snapshot:', {
      statusOrAmountChangedSameId: changed.map(o => `${o.status}/${o.amount} → ${nowById.get(o.id).status}/${nowById.get(o.id).amount}`),
      idVanished: gone.length,
      idNew: fresh.length,
    });
    // An id that vanished while a new id carries the same fan-less fingerprint (timestamp+amount) means ids change on a transition.
    const rekeyed = gone.filter(o => fresh.some(f => f.timestamp === o.timestamp && f.amount === o.amount));
    show('V4  vanished ids with a same-timestamp+amount newcomer (= id changed on a status transition):', String(rekeyed.length));
  }
  return { tx, start, end, pid };
}

// ── 3. chargebacks: V2 V5 ───────────────────────────────────────────────────
async function probeChargebacks(account, day) {
  section(`Chargebacks — account ${account.id}, 30 days to ${day} (V2, V5)`);
  const pid = account.platform_account_id;
  const { end } = dayBounds(day);
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  const cb = await paginate(`/api/v0/platforms/onlyfans/accounts/${pid}/chargebacks`, { start: start.toISOString(), end: end.toISOString(), limit: 1000 });
  show(`chargebacks: ${cb.items.length}`);
  if (!cb.items.length) {
    show('None in the window — re-run with a --day nearer a known chargeback.');
    return;
  }
  show('V5  type values  :', tally(cb.items, c => c.type));
  show('V5  status values:', tally(cb.items, c => c.status));
  report.chargebacks = cb.items.map(c => ({ id: c.id, fan: hashFan(c.fan?.id), type: c.type, status: c.status, amount: c.amount, chargeback_timestamp: c.chargeback_timestamp, transaction_timestamp: c.transaction_timestamp }));
  show('V2  timestamp shapes (chargeback / original):', { cb: tally(cb.items, c => c.chargeback_timestamp.replace(/\d/g, 'd')), tx: tally(cb.items, c => c.transaction_timestamp.replace(/\d/g, 'd')) });
  show('V5  amount signs :', tally(cb.items, c => (c.amount < 0 ? 'negative' : c.amount > 0 ? 'positive' : 'zero')));

  // For up to 10 chargebacks, look in /transactions for the original (exact transaction_timestamp, ±1 s)
  // and for the chargeback itself (does it ALSO appear as a transaction? — V5).
  const base = `/api/v0/platforms/onlyfans/accounts/${pid}/transactions`;
  console.log('\n  original-transaction match (exact timestamp window ±1s, same fan + |amount|):');
  const results = [];
  for (const c of cb.items.slice(0, 10)) {
    const t0 = new Date(c.transaction_timestamp).getTime();
    const body = await get(base, { start: new Date(t0 - 1000).toISOString(), end: new Date(t0 + 1000).toISOString(), limit: 100 });
    const sameFan = (body.items ?? []).filter(t => String(t.fan?.id) === String(c.fan.id));
    // Compare as INSTANTS (ms), and also report the raw-string result: '…:05Z' vs '…:05.000Z' must not
    // read as "no match". If the two numbers differ, the match key must normalise timestamps.
    const exactStr = sameFan.filter(t => t.timestamp === c.transaction_timestamp);
    const exact = sameFan.filter(t => Date.parse(t.timestamp) === Date.parse(c.transaction_timestamp));
    const amountMatch = exact.filter(t => Math.abs(Number(t.amount)) === Math.abs(Number(c.amount)));
    results.push({ amountMatch: amountMatch.length, exactTs: exact.length, exactStr: exactStr.length, sameFanWithin1s: sameFan.length });
    console.log(`   cb ${hashFan(c.id)} ${c.type} ${c.amount}: same-instant=${exact.length} (identical-string=${exactStr.length}), +amount=${amountMatch.length} ${amountMatch[0] ? `→ tx status=${amountMatch[0].status} type=${amountMatch[0].type} amount=${amountMatch[0].amount} ts=${amountMatch[0].timestamp} vs cb.transaction_timestamp=${c.transaction_timestamp}` : `(nearest same-fan tx within 1s: ${sameFan.map(t => `${t.timestamp}/${t.amount}`).join(', ') || 'none'})`}`);

    // V5: is there a row around the chargeback's own time that looks like it?
    const c0 = new Date(c.chargeback_timestamp).getTime();
    const around = await get(base, { start: new Date(c0 - 1000).toISOString(), end: new Date(c0 + 1000).toISOString(), limit: 100 });
    const echo = (around.items ?? []).filter(t => String(t.fan?.id) === String(c.fan.id) && Math.abs(Number(t.amount)) === Math.abs(Number(c.amount)));
    if (echo.length) console.log(`     V5 echo in /transactions at chargeback time: ${echo.map(t => `${t.status}/${t.type}/${t.amount}`).join(', ')}`);
  }
  show('V2  originals matched uniquely on (timestamp, fan, amount):', `${results.filter(r => r.amountMatch === 1).length} of ${results.length}`);
  show('V2  ambiguous (>1):', String(results.filter(r => r.amountMatch > 1).length));
  show('V2  zero matches  :', String(results.filter(r => r.amountMatch === 0).length));
  show('V2  matches by identical string vs by instant (must be equal, or the key needs normalising):', `${results.filter(r => r.exactStr > 0).length} vs ${results.filter(r => r.exactTs > 0).length}`);

  // The first run found 0 of 6 originals within ±1 s. Look wider to tell the three explanations
  // apart: (a) the original is no longer returned once charged back; (b) transaction_timestamp is
  // not the original's timestamp; (c) the chargeback's fan id is not the transaction's fan id.
  console.log('\n  wide search: ±3 days around transaction_timestamp, any fan:');
  const DAY = 24 * 3600 * 1000;
  const verdicts = [];
  for (const c of cb.items.slice(0, 6)) {
    const t0 = Date.parse(c.transaction_timestamp);
    const r = await paginate(base, { start: new Date(t0 - 3 * DAY).toISOString(), end: new Date(t0 + 3 * DAY).toISOString(), limit: 1000 }, { maxPages: 3 });
    const fanTx = r.items.filter(t => String(t.fan?.id) === String(c.fan.id));
    const lookalikes = r.items
      .filter(t => t.type === c.type && Math.abs(Number(t.amount)) === Math.abs(Number(c.amount)))
      .map(t => ({ dtSec: Math.round((Date.parse(t.timestamp) - t0) / 1000), sameFan: String(t.fan?.id) === String(c.fan.id), fan: hashFan(t.fan?.id), status: t.status }))
      .sort((x, y) => Math.abs(x.dtSec) - Math.abs(y.dtSec));
    const verdict = lookalikes.some(l => l.sameFan) ? 'present, timestamp differs (b)' : lookalikes.some(l => l.dtSec === 0) ? 'same instant, different fan id (c)' : fanTx.length ? 'fan present, no matching sale (a?)' : 'absent: not returned (a)';
    verdicts.push(verdict);
    console.log(`   cb ${c.type} ${c.amount} fan=${hashFan(c.fan.id)}: window rows ${r.items.length}${r.complete ? '' : '+'}, this fan's rows ${fanTx.length} ${fanTx.length ? JSON.stringify(fanTx.slice(0, 4).map(t => `${t.type}/${t.amount}/Δ${Math.round((Date.parse(t.timestamp) - t0) / 1000)}s/${t.status}`)) : ''}`);
    console.log(`      nearest same type+amount: ${lookalikes.length ? JSON.stringify(lookalikes.slice(0, 3)) : 'none'}  → ${verdict}`);
  }
  show('V5  verdicts:', tally(verdicts, v => v));
}

// ── 4. overview-metrics vs ledger: V3 ───────────────────────────────────────
async function probeOverview(account, day, tx) {
  section(`Overview-metrics vs transactions — ${day} (V3: net rounding and gross/net basis)`);
  const { start, end } = dayBounds(day);
  const pid = account.platform_account_id;
  const base = `/api/v0/platforms/onlyfans/accounts/${pid}/overview-metrics`;
  const from = `${day}T00:00:00${HARARE}`;
  const to = `${day}T23:59:59.999${HARARE}`;
  const net = await get(base, { from, to, earnings_type: 'net', include_subscription_revenue: true });
  const gross = await get(base, { from, to, earnings_type: 'gross', include_subscription_revenue: true });
  const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => /revenue|count|spenders|chargeback/i.test(k) && k !== 'month_total_revenue'));
  show('overview net  :', pick(net));
  show('overview gross:', pick(gross));

  const counted = tx.filter(t => t.amount != null);
  const gSum = sum(counted, t => t.amount);
  const perTxNet = round2(counted.reduce((s, t) => s + Math.round(Number(t.amount) * 0.8 * 100) / 100, 0));
  const sumNet = round2(gSum * 0.8);
  show('ledger Σ amount (gross)         :', String(gSum));
  show('ledger Σ round2(amount×0.8) each:', String(perTxNet));
  show('ledger round2(Σ amount × 0.8)   :', String(sumNet));
  show('V3  gross matches overview gross:', String(round2(gSum) === round2(gross.total_revenue)) + `  (Δ ${round2(gross.total_revenue - gSum)})`);
  show('V3  per-tx net matches overview net:', String(perTxNet === round2(net.total_revenue)) + `  (Δ ${round2(net.total_revenue - perTxNet)})`);
  show('V3  summed-then-rounded net matches:', String(sumNet === round2(net.total_revenue)) + `  (Δ ${round2(net.total_revenue - sumNet)})`);
  show('V3  by status Σ gross:', Object.fromEntries(Object.keys(tally(tx, t => t.status)).map(s => [s, sum(tx.filter(t => t.status === s), t => t.amount)])));
  report.overview = { net: pick(net), gross: pick(gross), ledgerGross: gSum, perTxNet, sumNet };
  report.notes.push('V3: if neither net figure matches, test by status (e.g. excluding pending_return) — the per-status gross sums above are for that.');
}

// ── 5. users/metrics vs transactions: V7 ────────────────────────────────────
async function probeUserMetrics(account, day, tx) {
  section(`users/metrics — ${day}, creator_ids=[${account.id}] (V7)`);
  const { start, end } = dayBounds(day);
  const body = await get('/api/v0/users/metrics', { from: start.toISOString(), to: end.toISOString(), creator_ids: [account.id], offset: 0, limit: 100 });
  let rows = body.items ?? [];
  show(`members returned with creator_ids=[${account.id}] (OnlyMonster account id): ${rows.length}`);
  if (rows.length === 0) {
    // An empty answer must not leave V7 open: try the platform id, and the unfiltered call.
    const bigIdOk = /^\d{1,15}$/.test(String(account.platform_account_id));
    if (bigIdOk) {
      const alt = await get('/api/v0/users/metrics', { from: start.toISOString(), to: end.toISOString(), creator_ids: [account.platform_account_id], offset: 0, limit: 100 });
      show(`V7  retry with creator_ids=[platform_account_id ${account.platform_account_id}]: ${(alt.items ?? []).length} rows`);
      if ((alt.items ?? []).length) {
        show('V7  → creator_ids takes the PLATFORM account id, not the OnlyMonster id');
        rows = alt.items;
      }
    }
    if (rows.length === 0) {
      const all = await get('/api/v0/users/metrics', { from: start.toISOString(), to: end.toISOString(), offset: 0, limit: 100 });
      show(`V7  unfiltered (all accounts): ${(all.items ?? []).length} rows; creator_ids seen:`, [...new Set((all.items ?? []).flatMap(r => r.creator_ids))].slice(0, 20));
      show('V7  → compare those ids against the account ids listed above to see which id space creator_ids uses.');
    }
  }
  show('V7  creator_ids echoed (is it the OnlyMonster account id?):', rows.slice(0, 5).map(r => r.creator_ids));
  const f = k => sum(rows, r => r[k]);
  const ppvTx = tx.filter(t => /^Payment for message/i.test(t.type));
  const tipTx = tx.filter(t => /^Tip/i.test(t.type));
  const postTx = tx.filter(t => /^Post purchase/i.test(t.type));
  show('V7  PPV:   Σ sold_messages_price_sum / Σ total_sold_messages_price_sum / transactions "Payment for message":', [f('sold_messages_price_sum'), f('total_sold_messages_price_sum'), sum(ppvTx, t => t.amount)]);
  show('V7  tips:  Σ tips_amount_sum / Σ total_tips_amount_sum / transactions "Tip…":', [f('tips_amount_sum'), f('total_tips_amount_sum'), sum(tipTx, t => t.amount)]);
  show('V7  posts: Σ sold_posts_price_sum / Σ total_sold_posts_price_sum / transactions "Post purchase":', [f('sold_posts_price_sum'), f('total_sold_posts_price_sum'), sum(postTx, t => t.amount)]);
  show('V7  reading guide:', 'sold_* ≈ transactions → gross, by purchase time. total_* ≥ sold_* means total_* is team-wide (not just attributed members). A mismatch against transactions means a different basis (net, or attribution window).');
  report.userMetrics = rows.map(r => ({ user_id: r.user_id, creator_ids: r.creator_ids, sold_messages_price_sum: r.sold_messages_price_sum, tips_amount_sum: r.tips_amount_sum, sold_posts_price_sum: r.sold_posts_price_sum, total_sold_messages_price_sum: r.total_sold_messages_price_sum, messages_count: r.messages_count, reply_time_avg: r.reply_time_avg }));
}

// ── 6. mass messages: V11 ───────────────────────────────────────────────────
async function probeMassMessages(account) {
  section(`Mass messages — account ${account.id} (V11)`);
  try {
    const body = await get(`/api/v0/accounts/${account.id}/mass-messages`, { limit: 5 });
    const items = body.items ?? [];
    show(`items on first page: ${items.length}   total=${body.total ?? '—'}`);
    if (items[0]) show('V11 field names:', Object.keys(items[0]));
    show('V11 statuses:', tally(items, m => m.status));
    show('V11 created_by sample:', items.slice(0, 3).map(m => m.created_by ?? '(absent)'));
  } catch (e) {
    show(`mass-messages failed: ${e.message}  (needs the mass_messages.view permission; the plan's key list in §4.3 names it)`);
  }
}

// ── 7. history: V6 ──────────────────────────────────────────────────────────
async function probeHistory(account) {
  section(`History — earliest month with transactions, account ${account.id} (V6)`);
  const pid = account.platform_account_id;
  const base = `/api/v0/platforms/onlyfans/accounts/${pid}/transactions`;
  const months = [];
  for (let y = 2025, m = 9; y < 2027 || m <= 12; ) {  // from September so an October-only start is visible
    months.push([y, m]);
    if (++m > 12) {
      m = 1;
      y++;
    }
    if (new Date(Date.UTC(y, m - 1, 1)) > new Date()) break;
  }
  let earliest = null;
  for (const [y, m] of months) {
    const s = new Date(Date.UTC(y, m - 1, 1));
    const e = new Date(Date.UTC(y, m, 1) - 1);
    const body = await get(base, { start: s.toISOString(), end: e.toISOString(), limit: 10 });
    const items = body.items ?? [];
    console.log(`   ${y}-${String(m).padStart(2, '0')}: ${items.length ? (body.cursor ? '10+' : items.length) : 0}`);
    if (items.length && !earliest) {
      // Newest-first, so the true earliest row of the month needs the last page; for the first month
      // with data, walk to the end (a month is a few hundred rows at most for an early-history probe).
      const full = await paginate(base, { start: s.toISOString(), end: e.toISOString(), limit: 1000 }, { maxPages: 10 });
      const oldest = full.items.map(t => t.timestamp).sort()[0];
      earliest = { month: `${y}-${String(m).padStart(2, '0')}`, oldest };
    }
  }
  show('V6  earliest month with data / oldest transaction in it:', earliest ?? 'none from 2025-09');
  show('V6  D9 needs coverage from 2025-10-04T00:00 Harare (= 2025-10-03T22:00Z):', earliest && earliest.oldest <= '2025-10-03T22:00:00Z' ? 'reached' : 'NOT shown to be reached — a first row after that date may mean a quiet account OR a short history; check the creator\'s start date. Gaps need the labelled-archive fallback (§6.3)');
}

// ── 7b. /users/metrics history: first day with any member activity (§7 backfill) ──
async function probeMetricsHistory() {
  section('users/metrics: first day with member activity (any account)');
  // Weekly steps from 27 Sep 2026 (ACTIVITY_START_DAY) to today: one call each.
  let first = null;
  for (let t = Date.parse('2026-09-26T22:00:00Z'); t < Date.now(); t += 7 * 24 * 3600 * 1000) {
    const body = await get('/api/v0/users/metrics', { from: new Date(t).toISOString(), to: new Date(t + 7 * 24 * 3600 * 1000 - 1).toISOString(), offset: 0, limit: 100 });
    const active = (body.items ?? []).filter(r => (r.messages_count ?? 0) > 0).length;
    console.log(`   week of ${new Date(t + 2 * 3600 * 1000).toISOString().slice(0, 10)}: ${(body.items ?? []).length} rows, ${active} with messages`);
    if (active && !first) first = new Date(t + 2 * 3600 * 1000).toISOString().slice(0, 10);
  }
  show('first week with member activity:', first ?? 'none');
}

// ── 8. volume: V10 ──────────────────────────────────────────────────────────
async function probeVolume(account) {
  section(`Volume — account ${account.id}, last 3 full months (V10)`);
  const pid = account.platform_account_id;
  const base = `/api/v0/platforms/onlyfans/accounts/${pid}/transactions`;
  const now = new Date();
  for (let i = 3; i >= 1; i--) {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1) - 1);
    const r = await paginate(base, { start: s.toISOString(), end: e.toISOString(), limit: 1000 }, { maxPages: 30 });
    console.log(`   ${s.toISOString().slice(0, 7)}: ${r.items.length}${r.complete ? '' : '+ (page cap hit)'} in ${r.pages} page(s)  ${JSON.stringify(tally(r.items, t => t.type))}`);
  }
}

// ── 9. Bluu side: V8 V9 (Firestore, read-only) ──────────────────────────────
async function compareBluu(accounts, members) {
  section('Bluu comparison — members↔users (V8), accounts↔creators (V9). Firestore read-only.');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) fail('FIREBASE_SERVICE_ACCOUNT is not set; --compare-bluu needs it.');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  // Ports of lib/authEmail.ts normalizeEmail and lib/onlymonster/mapping.ts foldHandle (kept in sync by hand;
  // this script is a one-off and must not import server-only TypeScript).
  const GMAIL = new Set(['gmail.com', 'googlemail.com']);
  const normEmail = e => {
    const t = String(e ?? '').trim().toLowerCase();
    const at = t.lastIndexOf('@');
    if (at <= 0 || at === t.length - 1) return '';
    let local = t.slice(0, at);
    const dom = t.slice(at + 1);
    if (GMAIL.has(dom)) {
      const p = local.indexOf('+');
      if (p >= 0) local = local.slice(0, p);
      local = local.replace(/\./g, '');
      return local ? `${local}@gmail.com` : '';
    }
    return `${local}@${dom}`;
  };
  const fold = raw => String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.)?onlyfans\.com\//, '').replace(/^@+/, '').replace(/\/+$/, '');

  const [users, creators, subs] = await Promise.all([
    db.collection('users').select('workEmail', 'displayName', 'isArchived', 'isActive').get(),
    db.collection('creators').select('stageName', 'OFID', 'platform').get(),
    db.collection('creator-subaccounts').select('stageName', 'OFID', 'platform').get(),
  ]);

  const byEmail = new Map();
  for (const d of users.docs) {
    const k = normEmail(d.get('workEmail'));
    if (k) byEmail.set(k, d);
  }
  const memberRows = members.map(m => ({ id: m.id, email: m.email, matched: byEmail.has(normEmail(m.email)) }));
  show(`V8  members matched to a Bluu user by normalised email: ${memberRows.filter(r => r.matched).length} of ${memberRows.length}`);
  for (const r of memberRows.filter(r => !r.matched)) console.log(`     NO MATCH  member ${r.id}  ${r.email}`);
  const active = users.docs.filter(d => d.get('isArchived') !== true && d.get('isActive') !== false);
  const memberKeys = new Set(members.map(m => normEmail(m.email)));
  const unmatchedUsers = active.filter(d => !memberKeys.has(normEmail(d.get('workEmail'))));
  show(`V8  active Bluu users with NO OnlyMonster member (expected: non-chatters): ${unmatchedUsers.length}`);

  const handleOwners = new Map();
  // The production rule (onlymonster-migration.md §4.2): only `platform: 'onlyfans'` accounts are
  // candidates for an OnlyFans account. Everything else is listed separately, never matched.
  const excluded = [];
  const add = (kind, d) => {
    const k = fold(d.get('OFID'));
    if (!k) return;
    if (d.get('platform') !== 'onlyfans') {
      excluded.push(`${kind}:${d.get('stageName')} (${d.get('platform') ?? 'NO PLATFORM'})`);
      return;
    }
    handleOwners.set(k, [...(handleOwners.get(k) ?? []), `${kind}:${d.id}:${d.get('stageName') ?? ''}${d.get('platform') ? ` (${d.get('platform')})` : ''}`]);
  };
  creators.docs.forEach(d => add('creator', d));
  subs.docs.forEach(d => add('sub', d));
  show(`V9  excluded from OnlyFans matching (platform is not onlyfans): ${excluded.length}`, excluded);
  const dup = [...handleOwners].filter(([, v]) => v.length > 1);
  show(`V9  handles claimed twice (map to nobody — fix before Phase 1): ${dup.length}`, dup.length ? Object.fromEntries(dup) : undefined);

  const of = accounts.filter(a => a.platform === 'onlyfans');
  const rows = of.map(a => ({ id: a.id, handle: fold(a.username), owners: handleOwners.get(fold(a.username)) ?? [] }));
  show(`V9  OnlyFans accounts matched to exactly one Bluu creator/sub-account: ${rows.filter(r => r.owners.length === 1).length} of ${rows.length}`);
  for (const r of rows.filter(r => r.owners.length !== 1)) console.log(`     ${r.owners.length === 0 ? 'NO MATCH' : 'AMBIGUOUS'}  account ${r.id} @${r.handle} ${r.owners.join(' | ')}`);
  const omHandles = new Set(of.map(a => fold(a.username)));
  const orphan = [...handleOwners].filter(([k]) => !omHandles.has(k));
  show(`V9  Bluu OFIDs with no OnlyMonster OnlyFans account (V13 candidates — compare to bx-* sales): ${orphan.length}`);
  for (const [k, v] of orphan) console.log(`     ${k}  ${v.join(' | ')}`);
  report.bluu = { memberRows, ofAccounts: rows };

  // V13 — does BuddyX feed any account into pay that OnlyMonster won't cover? Read-only, filtered in
  // memory so no new composite index is needed (month is single-field indexed).
  const months = (opt('months') ?? '').split(',').filter(Boolean);
  if (!months.length) {
    show('V13 skipped: pass --months 2026-10,2026-11 (the open payroll months) to check bx-* sales against OnlyMonster coverage.');
  } else {
    const covered = new Set(rows.filter(r => r.owners.length === 1).flatMap(r => r.owners.map(o => o.split(':')[1])));
    const names = new Map([...creators.docs, ...subs.docs].map(d => [d.id, `${d.get('stageName') ?? d.id}${d.get('platform') ? ` (${d.get('platform')})` : ''}`]));
    const bx = new Map();
    for (const m of months) {
      const snap = await db.collection('ca-sales').where('month', '==', m).select('source', 'creatorId', 'grossRevenue', 'removedAt').get();
      for (const d of snap.docs) {
        if (d.get('source') !== 'buddyx' || d.get('removedAt')) continue;
        const cid = d.get('creatorId');
        const cur = bx.get(cid) ?? { n: 0, gross: 0 };
        cur.n++;
        cur.gross += Number(d.get('grossRevenue')) || 0;
        bx.set(cid, cur);
      }
    }
    const uncovered = [...bx].filter(([cid]) => !covered.has(cid));
    show(`V13 creators/sub-accounts with live bx-* sales in ${months.join(', ')}: ${bx.size}; NOT covered by a mapped OnlyMonster OnlyFans account: ${uncovered.length}`);
    for (const [cid, v] of uncovered) console.log(`     UNCOVERED  ${cid}  ${names.get(cid) ?? '(unknown / buddyx:… unmapped)'}  ${v.n} sales, $${round2(v.gross)} gross`);
    report.bluu.v13Uncovered = uncovered.map(([cid, v]) => ({ creatorId: cid, name: names.get(cid) ?? null, ...v }));
  }
}

// ── main ────────────────────────────────────────────────────────────────────
// Every section runs in isolation: one failure (a 403 on a permission, a 400 on a parameter
// shape, the call budget) is printed and the run carries on, so a single round trip gathers
// as much as possible.
const failures = [];
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`\n  ✗ [${label}] ${err.message}`);
    if (err.status === 403) console.log('    (403: the key lacks a permission — details.required_permission names it)');
    return undefined;
  }
}

(async () => {
  console.log('\nOnlyMonster probe — GET only, allowlisted, budget', MAX_CALLS, 'calls. Fan ids are hashed (salt is per run).');
  const dir = await safe('directory', probeDirectory);
  if (!dir) fail('Directory failed, nothing else can run (check the key and its accounts.view / team_metrics.view permissions).');
  const { accounts, members } = dir;

  if (flag('coverage')) {
    await safe('coverage', async () => {
      section('Coverage: transactions before 2025-10-04 Harare, every OnlyFans account (V6)');
      // One call per account: any row in the 10 days BEFORE the D9 start proves history reaches it.
      for (const a of accounts.filter(x => x.platform === 'onlyfans')) {
        const body = await get(`/api/v0/platforms/onlyfans/accounts/${a.platform_account_id}/transactions`, { start: '2025-09-23T22:00:00.000Z', end: '2025-10-03T21:59:59.999Z', limit: 10 });
        const n = (body.items ?? []).length;
        console.log(`   ${String(a.id).padStart(7)} @${a.username.padEnd(18)} ${n ? `reached (${body.cursor ? '10+' : n} rows in 23 Sep – 3 Oct 2025)` : 'NO rows in 23 Sep – 3 Oct 2025: short history, or the account was quiet/new'}`);
      }
    });
  }

  let account;
  if (ACCOUNT) {
    account = accounts.find(a => String(a.id) === String(ACCOUNT));
    if (!account) fail(`--account ${ACCOUNT} is not in /accounts`);
    if (account.platform !== 'onlyfans') fail(`Account ${ACCOUNT} is ${account.platform}; the migration is OnlyFans only.`);
    const day = opt('day') ?? defaultDay();
    if (flag('history-only')) {
      await safe('history', () => probeHistory(account));
      await safe('metrics-history', () => probeMetricsHistory());
      section('Done');
      show(`API calls made: ${calls}`);
      return;
    }
    const txResult = await safe('transactions', () => probeTransactions(account, day));
    const tx = txResult?.tx ?? [];
    await safe('chargebacks', () => probeChargebacks(account, day));
    if (tx.length) {
      await safe('overview-metrics', () => probeOverview(account, day, tx));
      await safe('users/metrics', () => probeUserMetrics(account, day, tx));
    }
    await safe('mass-messages', () => probeMassMessages(account));
    if (flag('history')) await safe('history', () => probeHistory(account));
    if (flag('volume')) await safe('volume', () => probeVolume(account));
  } else {
    console.log('\n  (No --account given: directory only. Pick a busy OnlyFans account id from the list above and re-run.)');
  }
  if (flag('compare-bluu')) await safe('compare-bluu', () => compareBluu(accounts, members));

  section('Done');
  show(`API calls made: ${calls}`, tally(callLog, x => x.split(' ')[0]));
  if (failures.length) show('sections that failed:', failures);
  report.calls = calls;
  report.failures = failures;
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    show(`Full report written to ${OUT}`);
  }
  console.log('');
})().catch(err => {
  console.error(`\n  ✗ ${err.message}\n`);
  if (err.status === 403) console.error('  A 403 with API_KEY_PERMISSION_DENIED names the missing permission in details.required_permission.\n');
  process.exit(1);
});
