'use strict';
// Usage: cd src && node scripts/investigate-time-gap.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

// Load .env.local
const envPath = path.join(__dirname, '../.env.local');
const envLines = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
for (const line of envLines) {
  if (!line || line.startsWith('#')) continue;
  const eqIdx = line.indexOf('=');
  if (eqIdx > 0) {
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1);
    if (key) process.env[key] = val;
  }
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

const UID = 'aXJHoLisgPcRgdiZkhoQBO1IChq1';

// Apr 18 2026 in UTC (GMT+2 day boundaries)
const DAY_START_UTC = new Date('2026-04-17T22:00:00.000Z'); // midnight GMT+2
const DAY_END_UTC   = new Date('2026-04-18T22:00:00.000Z'); // end of day GMT+2

// The gap window in UTC
const GAP_START_UTC = new Date('2026-04-18T05:03:00.000Z'); // 07:03 GMT+2
const GAP_END_UTC   = new Date('2026-04-18T12:35:00.000Z'); // 14:35 GMT+2

function fmtUTC(ts) {
  if (!ts) return 'null';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function fmtGMT2(ts) {
  if (!ts) return 'null';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const offset = 2 * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offset);
  return local.toISOString().replace('T', ' ').slice(0, 19) + ' GMT+2';
}

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  Investigating time gap for user: ${UID}`);
  console.log(`  Date: 18 April 2026`);
  console.log(`  Gap window: 07:03–14:35 GMT+2  (05:03–12:35 UTC)`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  // ── 1. Find all time_entries sessions that overlap Apr 18 ──────────────
  console.log('── 1. time_entries covering Apr 18 ─────────────────────────\n');

  const entriesSnap = await db.collection('time_entries')
    .where('userId', '==', UID)
    .where('startTime', '>=', Timestamp.fromDate(DAY_START_UTC))
    .where('startTime', '<=', Timestamp.fromDate(DAY_END_UTC))
    .orderBy('startTime')
    .get();

  if (entriesSnap.empty) {
    console.log('  No time_entries found with startTime on Apr 18.\n');
    // also try broader range (session may have started the day before)
    const broadSnap = await db.collection('time_entries')
      .where('userId', '==', UID)
      .where('endTime', '>=', Timestamp.fromDate(DAY_START_UTC))
      .where('endTime', '<=', Timestamp.fromDate(new Date('2026-04-19T22:00:00.000Z')))
      .orderBy('endTime')
      .get();
    if (!broadSnap.empty) {
      console.log(`  Found ${broadSnap.size} entry(ies) with endTime on Apr 18:\n`);
      for (const doc of broadSnap.docs) {
        await printEntry(doc);
      }
    }
  } else {
    console.log(`  Found ${entriesSnap.size} entry(ies):\n`);
    for (const doc of entriesSnap.docs) {
      await printEntry(doc);
    }
  }

  // ── 1b. Search by legacy field names (old TimeEntryDocument format) ──
  console.log('\n── 1b. Legacy time_entries (createdTime field, old format) ─────\n');
  let legacySnap;
  try {
  legacySnap = await db.collection('time_entries')
    .where('userId', '==', UID)
    .where('createdTime', '>=', Timestamp.fromDate(DAY_START_UTC))
    .where('createdTime', '<=', Timestamp.fromDate(DAY_END_UTC))
    .orderBy('createdTime')
    .get();
  } catch(e) { console.log('  Query failed:', e.message.split('\n')[0]); legacySnap = null; }
  if (!legacySnap || legacySnap.empty) {
    console.log('  No legacy entries found on Apr 18.\n');
  } else {
    console.log(`  Found ${legacySnap.size} legacy entry(ies):\n`);
    for (const doc of legacySnap.docs) {
      const d = doc.data();
      console.log(`  ┌─ Doc: ${doc.id}`);
      console.log(`  │  createdTime: ${fmtGMT2(d.createdTime)}`);
      console.log(`  │  lastTime:    ${fmtGMT2(d.lastTime)}`);
      console.log(`  │  state:       ${d.state}`);
      console.log(`  │  durationS:   ${d.durationSeconds}`);
      console.log(`  └─\n`);
    }
  }

  // ── 1c. All time_entries for this user (no date filter, no orderBy) ─────
  console.log('\n── 1c. All time_entries for this user ───────────────────────\n');
  try {
    const allSnap = await db.collection('time_entries')
      .where('userId', '==', UID)
      .get();
    if (allSnap.empty) {
      console.log('  No entries at all.');
    } else {
      const docs = allSnap.docs.slice().sort((a, b) => {
        const ta = a.data().startTime?.toMillis?.() ?? a.data().createdTime?.toMillis?.() ?? 0;
        const tb = b.data().startTime?.toMillis?.() ?? b.data().createdTime?.toMillis?.() ?? 0;
        return tb - ta; // desc
      });
      console.log(`  All ${docs.length} session(s) for this user (most recent first):\n`);
      for (const doc of docs) {
        const d = doc.data();
        const logLen = d.eventLog ? d.eventLog.length : 'N/A';
        const start = d.startTime ? fmtGMT2(d.startTime) : (d.createdTime ? fmtGMT2(d.createdTime) + ' [legacy]' : 'N/A');
        const end   = d.endTime   ? fmtGMT2(d.endTime)   : (d.lastTime   ? fmtGMT2(d.lastTime)   + ' [legacy]' : 'N/A');
        console.log(`    ${doc.id}`);
        console.log(`      start: ${start}  end: ${end}  events: ${logLen}  didNotClockOut: ${d.didNotClockOut ?? d.userClockOut ?? 'N/A'}`);
      }
    }
  } catch(e) { console.log('  Query failed:', e.message.split('\n')[0]); }

  // ── 2. Screenshots around the gap window ──────────────────────────────
  console.log('\n── 2. Screenshots by sessionId (morning session) ───────────\n');
  // Since we know the morning screenshots show 06:31-07:03 GMT+2, look for
  // screenshot docs linked to those times via a collection group query by sessionId.
  // First try to find the session that covers the morning by querying all docs.
  let morningScreenshotsSnap, afternoonScreenshotsSnap;
  try {
    morningScreenshotsSnap = await db.collection('screenshots')
      .where('userId', '==', UID).orderBy('capturedAt', 'asc').limit(5).get();
    afternoonScreenshotsSnap = await db.collection('screenshots')
      .where('userId', '==', UID).orderBy('capturedAt', 'desc').limit(3).get();
  } catch(e) { console.log('  Screenshot query failed:', e.message.split('\n')[0]); morningScreenshotsSnap = afternoonScreenshotsSnap = null; }

  if (morningScreenshotsSnap) {
    console.log('  Earliest 5 screenshots for this user (by capturedAt asc):');
    for (const doc of morningScreenshotsSnap.docs) {
      const d = doc.data();
      console.log(`    capturedAt: ${fmtGMT2(d.capturedAt)}  sessionId: ${d.sessionId}`);
    }
    console.log('  Latest 3 screenshots for this user:');
    for (const doc of afternoonScreenshotsSnap.docs) {
      const d = doc.data();
      console.log(`    capturedAt: ${fmtGMT2(d.capturedAt)}  sessionId: ${d.sessionId}`);
    }
  }

  // ── 3. Active session doc at the time ─────────────────────────────────
  console.log('\n── 3. Current active_sessions doc ──────────────────────────\n');
  const activeDoc = await db.collection('active_sessions').doc(UID).get();
  if (!activeDoc.exists) {
    console.log('  No active_sessions document for this user (expected if clocked out).');
  } else {
    const d = activeDoc.data();
    console.log(`  sessionId:    ${d.sessionId}`);
    console.log(`  startTime:    ${fmtGMT2(d.startTime)}`);
    console.log(`  lastUpdated:  ${fmtGMT2(d.lastUpdated)}`);
    console.log(`  currentState: ${d.currentState}`);
    console.log(`  userClockOut: ${d.userClockOut}`);
  }

  console.log('\nDone.');
}

async function printEntry(doc) {
  const d = doc.data();
  console.log(`  ┌─ Session: ${doc.id}`);
  console.log(`  │  startTime:       ${fmtGMT2(d.startTime)}`);
  console.log(`  │  endTime:         ${fmtGMT2(d.endTime)}`);
  console.log(`  │  workingSeconds:  ${d.workingSeconds}s (${(d.workingSeconds/3600).toFixed(2)}h)`);
  console.log(`  │  idleSeconds:     ${d.idleSeconds}s`);
  console.log(`  │  breakSeconds:    ${d.breakSeconds}s`);
  console.log(`  │  pauseSeconds:    ${d.pauseSeconds}s`);
  console.log(`  │  didNotClockOut:  ${d.didNotClockOut}`);
  console.log(`  │  status:          ${d.status}`);
  console.log(`  │  logUploadedAt:   ${fmtGMT2(d.logUploadedAt)}`);
  console.log(`  │  timezone:        ${d.timezone}`);
  console.log(`  │  isManual:        ${d.isManual}`);

  const events = d.eventLog || [];
  console.log(`  │  eventLog:        ${events.length} events`);

  if (events.length > 0) {
    console.log(`  │`);
    console.log(`  │  ── Event log ──────────────────────────────────────────`);
    for (const ev of events) {
      const ts = new Date(ev.timestamp);
      const inGap = ts >= GAP_START_UTC && ts <= GAP_END_UTC;
      const marker = inGap ? ' ◄ GAP' : '';
      const metaStr = ev.meta ? '  ' + JSON.stringify(ev.meta) : '';
      console.log(`  │  ${fmtGMT2(ts)}  ${ev.type.padEnd(14)}${metaStr}${marker}`);
    }
  }
  console.log(`  └─────────────────────────────────────────────────────────\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
