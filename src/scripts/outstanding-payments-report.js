/**
 * Report: outstanding payments & incomplete entries in `campaign-tracking`.
 *
 * Scans every campaign-tracking entry and reports, grouped by the user who
 * created it (createdBy):
 *   - Entries with status = "In Progress".
 *   - Entries with status = "Completed" that still have an outstanding payment.
 * For each listed entry it shows CR code (or type when there is no CR code),
 * fan name, created date, and the outstanding amount (totalAmount - amountPaid).
 * A per-user total of outstanding payments is printed at the end of each group.
 *
 * Usage (from repo root):
 *   node src/scripts/outstanding-payments-report.js
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in environment (or in src/.env.local).
 */

const path = require('path');
const fs = require('fs');

// Load src/.env.local if present
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT env var is required.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const db = admin.firestore();

/** Coerce a Firestore Timestamp / string / Date into a Date, or null. */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD, or "unknown" when the date is missing. */
function fmtDate(date) {
  return date ? date.toISOString().slice(0, 10) : 'unknown';
}

function fmtMoney(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** Resolve a user UID → display name, falling back through the standard chain. */
function resolveUserName(data) {
  if (!data) return '';
  if (data.displayName) return data.displayName;
  const composed = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
  return composed;
}

async function buildNameMap(collection, ids, resolver) {
  const map = {};
  const unique = [...new Set(ids.filter(Boolean))];
  // Batch reads via getAll to avoid N+1 lookups.
  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300);
    const refs = chunk.map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      map[snap.id] = snap.exists ? resolver(snap.data()) : '';
    }
  }
  return map;
}

async function run() {
  const snapshot = await db.collection('campaign-tracking').get();

  // Gather entries we care about and collect UIDs / creator IDs for name resolution.
  const createdByIds = [];
  const creatorIds = [];
  const relevant = [];

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const status = d.status;
    const total = Number(d.totalAmount) || 0;
    const paid = Number(d.amountPaid) || 0;
    const outstanding = total - paid;
    const hasOutstanding = outstanding > 0;

    const isInProgress = status === 'In Progress';
    const isCompletedUnpaid = status === 'Completed' && hasOutstanding;

    if (!isInProgress && !isCompletedUnpaid) continue;

    // Skip entries with no CR code that are already fully paid — nothing
    // outstanding and no code to chase, so they're not worth reporting.
    const hasCR = !!(d.CR || '').trim();
    if (!hasCR && !hasOutstanding) continue;

    createdByIds.push(d.createdBy);
    creatorIds.push(d.creatorID);

    relevant.push({
      id: doc.id,
      createdBy: d.createdBy || '',
      creatorID: d.creatorID || '',
      CR: (d.CR || '').trim(),
      type: d.type || '',
      fanName: d.fanName || '',
      status,
      createdDate: toDate(d.createdTime),
      total,
      paid,
      outstanding,
      hasOutstanding,
      reason: isInProgress ? 'In Progress' : 'Completed (unpaid)',
    });
  }

  const [userNames, creatorNames] = await Promise.all([
    buildNameMap('users', createdByIds, resolveUserName),
    buildNameMap('creators', creatorIds, (data) => (data && data.stageName) || ''),
  ]);

  // Group by createdBy.
  const groups = new Map();
  for (const entry of relevant) {
    if (!groups.has(entry.createdBy)) groups.set(entry.createdBy, []);
    groups.get(entry.createdBy).push(entry);
  }

  // Sort groups by user name for stable, readable output.
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const na = userNames[a[0]] || a[0] || 'zzz';
    const nb = userNames[b[0]] || b[0] || 'zzz';
    return na.localeCompare(nb);
  });

  const lines = [];
  lines.push('='.repeat(78));
  lines.push('OUTSTANDING PAYMENTS & INCOMPLETE ENTRIES — campaign-tracking');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('='.repeat(78));
  lines.push('');

  let grandTotalOutstanding = 0;
  let grandEntryCount = 0;

  for (const [createdBy, entries] of sortedGroups) {
    const userLabel = userNames[createdBy] || (createdBy ? `Deleted User (${createdBy})` : 'No createdBy');
    lines.push('-'.repeat(78));
    lines.push(`USER: ${userLabel}`);
    lines.push('-'.repeat(78));

    // Sub-group by creator for readability.
    const byCreator = new Map();
    for (const e of entries) {
      if (!byCreator.has(e.creatorID)) byCreator.set(e.creatorID, []);
      byCreator.get(e.creatorID).push(e);
    }

    const sortedCreators = [...byCreator.entries()].sort((a, b) => {
      const na = creatorNames[a[0]] || a[0] || 'zzz';
      const nb = creatorNames[b[0]] || b[0] || 'zzz';
      return na.localeCompare(nb);
    });

    let userOutstanding = 0;

    for (const [creatorID, creatorEntries] of sortedCreators) {
      const creatorLabel = creatorNames[creatorID] || (creatorID ? `Unknown creator (${creatorID})` : 'No creator');
      lines.push(`  Creator: ${creatorLabel}`);

      // In progress first, then completed-unpaid; then by date.
      creatorEntries.sort((a, b) => {
        if (a.reason !== b.reason) return a.reason === 'In Progress' ? -1 : 1;
        return (a.createdDate?.getTime() || 0) - (b.createdDate?.getTime() || 0);
      });

      for (const e of creatorEntries) {
        // Identifier: CR code, or type when there is no CR code.
        const identifier = e.CR ? e.CR : `[${e.type || 'Unknown type'}]`;
        const payNote = e.hasOutstanding
          ? `OUTSTANDING ${fmtMoney(e.outstanding)} (paid ${fmtMoney(e.paid)} of ${fmtMoney(e.total)})`
          : `paid in full (${fmtMoney(e.total)})`;
        const statusNote = e.reason === 'Completed (unpaid)' ? ' [COMPLETED]' : '';

        lines.push(
          `    - ${identifier} | ${e.fanName || 'no fan name'} | ${fmtDate(e.createdDate)}` +
          ` | ${payNote}${statusNote}`
        );

        userOutstanding += e.outstanding > 0 ? e.outstanding : 0;
        grandEntryCount += 1;
      }
    }

    lines.push('');
    lines.push(`  >> TOTAL OUTSTANDING for ${userLabel}: ${fmtMoney(userOutstanding)} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`);
    lines.push('');

    grandTotalOutstanding += userOutstanding;
  }

  lines.push('='.repeat(78));
  lines.push(`GRAND TOTAL OUTSTANDING (all users): ${fmtMoney(grandTotalOutstanding)}`);
  lines.push(`Entries listed: ${grandEntryCount} across ${sortedGroups.length} user(s)`);
  lines.push('='.repeat(78));

  const report = lines.join('\n');
  console.log(report);

  // Also write a timestamped copy next to the script for record-keeping.
  const outName = `outstanding-payments-report-${new Date().toISOString().slice(0, 10)}.txt`;
  const outPath = path.join(__dirname, outName);
  fs.writeFileSync(outPath, report, 'utf8');
  console.log(`\nReport written to ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
