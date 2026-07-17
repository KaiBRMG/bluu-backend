/**
 * Daily analytics rollup — the compute core.
 *
 * Shared verbatim by the `rollupDailyAnalytics` Cloud Function (index.js) and
 * the historical backfill script (src/scripts/backfill-analytics-rollups.js) so
 * that live and backfilled documents are byte-identical. Plain CommonJS, no
 * build step, no external date library.
 *
 * Writes one analytics_daily/{userId}_{YYYY-MM-DD} document per user per LOCAL
 * day. Exists because no Firestore index supports querying `time_entries`
 * without `userId`, so company-wide analytics would otherwise fan out across
 * every user on every dashboard load.
 *
 * ── Mirrors (keep in sync) ──────────────────────────────────────────────────
 * This file re-implements logic that also lives in TypeScript. Firebase
 * Functions cannot import from src/, so these are deliberate mirrors — the same
 * convention as `resolvePageIds` in index.js. If you change one, change both:
 *   buildSegments        ↔ src/lib/utils/sessionSegments.ts  (sessionToSegments)
 *   computeBreakAllowance ↔ src/contexts/TimeTrackingContext.tsx
 *   getDayBoundsUTC / toLocalDateStr / addCalendarDays ↔ src/lib/utils/timezone.ts
 */

// Resolves to functions/node_modules/firebase-admin. The repo has a SECOND,
// different copy at src/node_modules (v13 vs v12 here), and Firestore rejects
// Timestamp/FieldValue instances minted by a different copy than the one that
// created the Firestore handle ("not a valid Firestore document. Detected an
// object of type Timestamp that doesn't match the expected instance").
//
// So this module re-exports `admin`, and every caller MUST build its Firestore
// handle from the export rather than its own require — see the backfill script.
// The Cloud Function is already safe: functions/index.js resolves to this copy.
const admin = require('firebase-admin');

// ─── Constants (mirror the renderer's) ───────────────────────────────

const SEG_WORKING = 0;
const SEG_IDLE    = 1;
const SEG_BREAK   = 2;
const SEG_PAUSE   = 3;

/** TimeTrackingContext.SLEEP_GAP_THRESHOLD_MS — 15min heartbeat + 5min slack. */
const SLEEP_GAP_THRESHOLD_MS = 20 * 60 * 1000;
/** patchSleepGap stamps its synthetic pause at exactly lastEvent.timestamp + 1000. */
const SYNTHETIC_PAUSE_OFFSET_MS = 1000;

const FOCUS_BLOCK_MIN_SECONDS = 1500;   // 25 min — the shortest run worth calling "focus"
const BREAK_DURATION_SECONDS  = 2700;   // 45-minute allowance per period
const WORK_PERIOD_SECONDS     = 8 * 3600;
const NO_BREAK_MIN_WORKING_SECONDS = 4 * 3600;

/** Defensive cap — a day with this many state transitions is pathological. */
const MAX_SEGMENTS = 500;

// ─── Timezone helpers (mirror src/lib/utils/timezone.ts) ─────────────

/** Offset (ms) between local wall-clock and UTC at a given instant. */
function tzOffsetMs(utcMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const map = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some ICU builds emit 24 for midnight

  const asUTC = Date.UTC(
    parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10),
    hour, parseInt(map.minute, 10), parseInt(map.second, 10),
  );
  return asUTC - utcMs;
}

/** UTC ms bounds [start, end] of a YYYY-MM-DD calendar date in `timezone`. */
function getDayBoundsUTC(dateStr, timezone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offsetMs = tzOffsetMs(noonUTC, timezone);
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  return { start: dayStartUTC, end: dayStartUTC + 24 * 60 * 60 * 1000 - 1 };
}

function toLocalDateStr(utcMs, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(utcMs));
}

function todayStr(timezone) {
  return toLocalDateStr(Date.now(), timezone || 'UTC');
}

function addCalendarDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Mirror of TimeTrackingContext.computeBreakAllowance. */
function computeBreakAllowance(workingSeconds) {
  const periods = Math.floor(workingSeconds / WORK_PERIOD_SECONDS) + 1;
  return periods * BREAK_DURATION_SECONDS;
}

// ─── Event log → segments ────────────────────────────────────────────

/**
 * Which `pause` events were injected by TimeTrackingContext.patchSleepGap to
 * retroactively exclude a span the machine was asleep, rather than clicked by
 * the user?
 *
 * A synthetic pause is stamped at exactly `prevEvent.timestamp + 1000` and its
 * matching `resume` lands more than SLEEP_GAP_THRESHOLD_MS later, because the
 * patch only fires when a heartbeat gap exceeds that threshold. Both conditions
 * together make a false positive very unlikely.
 *
 * This is a heuristic. The durable fix is tagging the event with
 * `meta: { trigger: 'sleep-gap' }` at the injection site — see the Analytics
 * findings in documentation/time-tracking.md. Until then, a machine sleeping
 * would otherwise be counted as a user-initiated interruption to focus.
 */
function findSyntheticPauses(eventLog) {
  const synthetic = new Set();
  for (let i = 1; i < eventLog.length; i++) {
    const e = eventLog[i];
    if (e.type !== 'pause') continue;

    // The tag, once patchSleepGap starts writing it, is authoritative.
    if (e.meta && e.meta.trigger === 'sleep-gap') { synthetic.add(i); continue; }

    const prev = eventLog[i - 1];
    const next = eventLog[i + 1];
    if (!prev || !next || next.type !== 'resume') continue;
    if (e.timestamp !== prev.timestamp + SYNTHETIC_PAUSE_OFFSET_MS) continue;
    if (next.timestamp - e.timestamp < SLEEP_GAP_THRESHOLD_MS - SYNTHETIC_PAUSE_OFFSET_MS) continue;
    synthetic.add(i);
  }
  return synthetic;
}

/**
 * Decompose a session's event log into [startMs, endMs, code] segments.
 *
 * Mirrors src/lib/utils/sessionSegments.ts `sessionToSegments` exactly so the
 * rollup agrees with the timesheet. Callers must NOT pass an empty event log —
 * see the trap note in computeUserDay.
 */
function buildSegments(eventLog, sessionStartMs, sessionEndMs) {
  const segments = [];
  const synthetic = findSyntheticPauses(eventLog);
  let asleepSeconds = 0;
  let interruptionCount = 0;

  let segStart = sessionStartMs;
  let idleStart = null;
  let breakStart = null;
  let pauseStart = null;
  let pauseIsSynthetic = false;

  const emit = (code, startMs, endMs) => {
    if (endMs <= startMs) return;
    segments.push([startMs, endMs, code]);
  };

  for (let i = 0; i < eventLog.length; i++) {
    const event = eventLog[i];
    const t = event.timestamp;

    switch (event.type) {
      case 'idle-start':
        emit(SEG_WORKING, segStart, t);
        segStart = t;
        idleStart = t;
        interruptionCount++;
        break;
      case 'idle-end':
        if (idleStart !== null) emit(SEG_IDLE, idleStart, t);
        idleStart = null;
        segStart = t;
        break;
      case 'break-start':
        emit(SEG_WORKING, segStart, t);
        segStart = t;
        breakStart = t;
        interruptionCount++;
        break;
      case 'break-end':
        if (breakStart !== null) emit(SEG_BREAK, breakStart, t);
        breakStart = null;
        segStart = t;
        break;
      case 'pause':
        emit(SEG_WORKING, segStart, t);
        segStart = t;
        pauseStart = t;
        pauseIsSynthetic = synthetic.has(i);
        // A machine falling asleep is not an interruption to focus.
        if (!pauseIsSynthetic) interruptionCount++;
        break;
      case 'resume':
        if (pauseStart !== null) {
          emit(SEG_PAUSE, pauseStart, t);
          if (pauseIsSynthetic) asleepSeconds += Math.floor((t - pauseStart) / 1000);
        }
        pauseStart = null;
        pauseIsSynthetic = false;
        segStart = t;
        break;
      case 'clock-out':
        if (idleStart !== null) { emit(SEG_IDLE, idleStart, t); idleStart = null; }
        else if (breakStart !== null) { emit(SEG_BREAK, breakStart, t); breakStart = null; }
        else if (pauseStart !== null) {
          emit(SEG_PAUSE, pauseStart, t);
          if (pauseIsSynthetic) asleepSeconds += Math.floor((t - pauseStart) / 1000);
          pauseStart = null;
        }
        else emit(SEG_WORKING, segStart, t);
        segStart = t;
        break;
      default:
        // 'clock-in' / 'activity' / 'screenshot' are markers — no state change
        break;
    }
  }

  // Close whatever is still open against the session end
  if (idleStart !== null) emit(SEG_IDLE, idleStart, sessionEndMs);
  else if (breakStart !== null) emit(SEG_BREAK, breakStart, sessionEndMs);
  else if (pauseStart !== null) {
    emit(SEG_PAUSE, pauseStart, sessionEndMs);
    if (pauseIsSynthetic) asleepSeconds += Math.floor((sessionEndMs - pauseStart) / 1000);
  }
  else if (segStart < sessionEndMs) emit(SEG_WORKING, segStart, sessionEndMs);

  return { segments, asleepSeconds, interruptionCount };
}

/**
 * Add a span's seconds to the per-LOCAL-hour buckets, splitting it at local
 * hour boundaries. The offset is resampled each chunk, so DST transitions land
 * in the right bucket.
 */
function addToHourBuckets(buckets, startMs, endMs, timezone) {
  let cur = startMs;
  let guard = 0;
  while (cur < endMs && guard++ < 10_000) {
    const offset = tzOffsetMs(cur, timezone);
    const localMs = cur + offset;
    const hourIndex = Math.floor(localMs / 3_600_000);
    const nextBoundaryUtc = (hourIndex + 1) * 3_600_000 - offset;
    const chunkEnd = Math.min(endMs, nextBoundaryUtc);
    if (chunkEnd <= cur) break; // offset moved backwards (DST) — stop rather than spin

    const hour = ((hourIndex % 24) + 24) % 24;
    buckets[hour] += Math.floor((chunkEnd - cur) / 1000);
    cur = chunkEnd;
  }
}

// ─── Per-user, per-day rollup ────────────────────────────────────────

/**
 * Compute one analytics_daily document. Returns null when the user has no
 * activity that day — absence of a document IS the "did not work" signal, which
 * keeps the collection small and makes consecutive-day streaks derivable.
 */
async function computeUserDay(db, userId, userData, dateStr) {
  const timezone = (userData && userData.timezone) || 'UTC';
  const { start, end } = getDayBoundsUTC(dateStr, timezone);
  const Timestamp = admin.firestore.Timestamp;

  const [entriesSnap, shotsSnap] = await Promise.all([
    db.collection('time_entries')
      .where('userId', '==', userId)
      .where('startTime', '>=', Timestamp.fromMillis(start))
      .where('startTime', '<=', Timestamp.fromMillis(end))
      .get(),
    db.collection('screenshots')
      .where('userId', '==', userId)
      .where('timestampUTC', '>=', Timestamp.fromMillis(start))
      .where('timestampUTC', '<=', Timestamp.fromMillis(end))
      .get(),
  ]);

  if (entriesSnap.empty && shotsSnap.empty) return null;

  let workingSeconds = 0, idleSeconds = 0, breakSeconds = 0, pauseSeconds = 0;
  let asleepSeconds = 0, unknownSeconds = 0;
  let focusBlockCount = 0, focusSecondsInBlocks = 0, longestFocusBlockSeconds = 0;
  let interruptionCount = 0;
  let hasIncompleteLog = false, hasManualEntry = false;
  let firstClockInMs = null, lastClockOutMs = null;

  const hourBuckets = new Array(24).fill(0);
  const segments = [];       // flat triples — Firestore has no nested arrays
  const sessionBounds = [];  // flat pairs
  const sessionIds = [];

  for (const doc of entriesSnap.docs) {
    const d = doc.data();
    const sMs = d.startTime.toMillis();
    const eMs = d.endTime ? d.endTime.toMillis() : sMs;

    sessionIds.push(d.sessionId || doc.id);
    sessionBounds.push(sMs, eMs);
    if (firstClockInMs === null || sMs < firstClockInMs) firstClockInMs = sMs;
    if (lastClockOutMs === null || eMs > lastClockOutMs) lastClockOutMs = eMs;

    const log = Array.isArray(d.eventLog) ? d.eventLog : [];

    if (log.length === 0) {
      if (d.isManual === true) {
        // Admin-entered time has no event log by nature. Trust its aggregates
        // and synthesise one working span so schedule adherence and coverage
        // still credit it. Deliberately excluded from focus metrics — there is
        // no event data to judge focus from.
        hasManualEntry = true;
        workingSeconds += d.workingSeconds || 0;
        idleSeconds    += d.idleSeconds    || 0;
        breakSeconds   += d.breakSeconds   || 0;
        pauseSeconds   += d.pauseSeconds   || 0;
        if (eMs > sMs) {
          segments.push(sMs, eMs, SEG_WORKING);
          addToHourBuckets(hourBuckets, sMs, eMs, timezone);
        }
      } else {
        // TRAP: cleanupStaleSessions writes workingSeconds:0 WITH an empty
        // eventLog, and sessionToSegments/computeWorkedInWindow both treat an
        // empty log as one full working segment. Feeding this to them would
        // claim the entire session span as work. The log arrives later via
        // /upload-log (which marks the day dirty); until then the span is
        // genuinely unknown, so record it as such rather than inventing work.
        hasIncompleteLog = true;
        unknownSeconds += Math.max(0, Math.floor((eMs - sMs) / 1000));
      }
      continue;
    }

    if (d.isManual === true) hasManualEntry = true;

    const built = buildSegments(log, sMs, eMs);
    asleepSeconds += built.asleepSeconds;
    interruptionCount += built.interruptionCount;

    for (const [a, b, code] of built.segments) {
      // Floor per segment, matching parseBuffer, so working/idle/break agree
      // with the ledger and the timesheet exactly.
      const secs = Math.floor((b - a) / 1000);
      segments.push(a, b, code);

      if (code === SEG_WORKING) {
        workingSeconds += secs;
        addToHourBuckets(hourBuckets, a, b, timezone);
        // Segments only ever break at idle/break/pause, so each working segment
        // IS a maximal uninterrupted run.
        if (secs >= FOCUS_BLOCK_MIN_SECONDS) {
          focusBlockCount++;
          focusSecondsInBlocks += secs;
          if (secs > longestFocusBlockSeconds) longestFocusBlockSeconds = secs;
        }
      } else if (code === SEG_IDLE)  idleSeconds  += secs;
      else if (code === SEG_BREAK)   breakSeconds += secs;
      else if (code === SEG_PAUSE)   pauseSeconds += secs;
    }
  }

  let cappedSegments = segments;
  if (segments.length > MAX_SEGMENTS * 3) {
    // Pathological day — keep the timeline bounded and flag the day as
    // approximate rather than silently truncating adherence.
    cappedSegments = segments.slice(0, MAX_SEGMENTS * 3);
    hasIncompleteLog = true;
    console.warn(`[rollup] ${userId} ${dateStr}: ${segments.length / 3} segments — capped at ${MAX_SEGMENTS}`);
  }

  // ── Activity, deduped by captureGroup ──────────────────────────────
  // Screenshots are one document PER SCREEN, and every screen in a capture
  // group carries the same activityPercent. Counting rows would double-weight
  // multi-monitor users in both the mean and the histogram.
  let screenshotCount = 0, activitySum = 0, activityCount = 0;
  const activityHistogram = new Array(10).fill(0);
  const seenGroups = new Set();

  for (const doc of shotsSnap.docs) {
    const d = doc.data();
    const group = d.captureGroup || doc.id;
    if (seenGroups.has(group)) continue;
    seenGroups.add(group);
    screenshotCount++;

    const pct = d.activityPercent;
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      const clamped = Math.max(0, Math.min(100, pct));
      activitySum += clamped;
      activityCount++;
      activityHistogram[Math.min(9, Math.floor(clamped / 10))]++;
    }
  }

  const clockedSpanSeconds = (firstClockInMs !== null && lastClockOutMs !== null)
    ? Math.max(0, Math.floor((lastClockOutMs - firstClockInMs) / 1000))
    : 0;

  return {
    version: 1,
    userId,
    date: dateStr,
    timezone,
    groupsSnapshot: Array.isArray(userData && userData.groups) ? userData.groups : [],
    computedAt: admin.firestore.FieldValue.serverTimestamp(),

    workingSeconds, idleSeconds, breakSeconds, pauseSeconds, asleepSeconds,
    clockedSpanSeconds, unknownSeconds,
    sessionCount: entriesSnap.size,
    firstClockInMs, lastClockOutMs,

    screenshotCount, activitySum, activityCount, activityHistogram,

    segments: cappedSegments,
    sessionBounds,
    hourBuckets,

    focusBlockCount, focusSecondsInBlocks, longestFocusBlockSeconds, interruptionCount,

    breakAllowanceSeconds: computeBreakAllowance(workingSeconds),
    noBreakDay: workingSeconds >= NO_BREAK_MIN_WORKING_SECONDS && breakSeconds === 0,

    hasIncompleteLog, hasManualEntry, sessionIds,
  };
}

function rollupDocId(userId, dateStr) {
  return `${userId}_${dateStr}`;
}

/**
 * Compute and persist one user-day. Full overwrite via set() — never merge,
 * never increment — so re-running any day any number of times converges.
 * Returns 'written' | 'deleted' | 'skipped'.
 */
async function rollupUserDay(db, userId, userData, dateStr, { dryRun = false } = {}) {
  const doc = await computeUserDay(db, userId, userData, dateStr);
  const ref = db.collection('analytics_daily').doc(rollupDocId(userId, dateStr));

  if (!doc) {
    if (dryRun) return 'skipped';
    // A day that previously had activity may now have none (entries deleted).
    const existing = await ref.get();
    if (existing.exists) { await ref.delete(); return 'deleted'; }
    return 'skipped';
  }

  if (dryRun) return 'written';
  await ref.set(doc);
  return 'written';
}

module.exports = {
  /**
   * The firebase-admin instance this module builds Timestamps/FieldValues with.
   * Callers outside functions/ MUST use this to initializeApp() and create their
   * Firestore handle — a handle from a different copy of the package will reject
   * every document this module produces.
   */
  admin,
  SEG_WORKING, SEG_IDLE, SEG_BREAK, SEG_PAUSE,
  FOCUS_BLOCK_MIN_SECONDS,
  tzOffsetMs, getDayBoundsUTC, toLocalDateStr, todayStr, addCalendarDays,
  computeBreakAllowance, findSyntheticPauses, buildSegments, addToHourBuckets,
  computeUserDay, rollupUserDay, rollupDocId,
};
