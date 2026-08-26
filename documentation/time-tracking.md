# Time Tracking

> Event-log session architecture, elapsed-time derivation, crash/restart robustness, and activity-percent calculation. This is the most bug-sensitive subsystem — read the **rules** before touching any elapsed-time code.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `functions/rollup.js` | **Analytics rollup compute core** (shared by the CF + backfill script) |
| `src/lib/services/analyticsService.ts` | Rollup reads + the `analytics_dirty` queue |
| `src/lib/utils/analyticsAggregate.ts` | Pure aggregation over rollups (no Firestore) |
| `src/lib/utils/shiftAttendance.ts` | `computeAttendance` / `computeTimeWorked` + rollup variants |
| `src/components/admin/shift-management/analytics/` | The Analytics tab |
| `src/lib/localBuffer.ts` | Local event buffer (append-only event log) |
| `src/lib/parseBuffer.ts` | `parseBuffer(events, nowMs)` + **`sessionCloseMs(buf, isActive, now)`** |
| `src/contexts/TimeTrackingContext.tsx` | Orchestration: clock in/out, hydration, screenshot upload, `calcActivityPercent` |
| `src/lib/timerWidget.ts` | Payload for the always-visible timer widget (§7) |
| `src/hooks/useTimeTracking.ts` | Hook surface over the context |
| `src/hooks/useTodaySessions.ts` | **Today's sessions from BOTH sources** — local buffers + committed ledger |
| `src/hooks/useDayTotal.ts` | The "TODAY" total |
| `src/components/timesheet/TodayTimeline.tsx` | Timeline bars + per-row totals |
| `src/components/timesheet/DayTimeline.tsx` | One day's segment bar + tooltip; opens the walkthrough |
| `src/components/timesheet/SessionWalkthroughDialog.tsx` | Per-session event-log walkthrough (§6) |
| `src/hooks/useTimesheetData.ts` | Timesheet cache (5 min TTL) |
| API: `src/app/api/time-tracking/*/route.ts` | `start`, `stop`, `clock-out`, `discard`, `heartbeat`, `transition`, `status`, `upload-log`, `entries`, `screenshots/*` |
| `electron/main.js`, `electron/preload.js` | `timeTracking:getActivitySince` IPC (powerMonitor) |
| `src/types/electron.d.ts` | `electronAPI.timeTracking.getActivitySince` type |
| Cloud Function (`functions/`) | Daily stale-session cleanup |

## Firestore

- `active_sessions/{userId}` — keyed by **uid**, so a user can only ever have **one** server-side active session. **"Two active sessions" symptoms are ALWAYS a client-side rendering/buffer issue, never two server docs.** Deleted on clock-out. Because it is keyed by uid, clocking in on a second device **displaces** the doc — see §3b for why that must never delete the old session outright.
- `time_entries/{sessionId}` — permanent ledger written at clock-out. Keyed by uid too, so **sessions tracked on different devices all land in the same timesheet**; the doc id **is** the session id, which is what makes de-duplicating local buffers against the ledger exact (§2b).

---

## 1. Session Architecture (event log)

```
Client appends events ──► local buffer (localBuffer.ts)
   [clock-in, idle-start, break-start, ...]
        │
        │ periodic
        ▼
   /api/time-tracking/heartbeat ──► active_sessions/{userId}.lastUpdated + currentState
        │
        │ on clock-out
        ▼
   full event log uploaded ──► time_entries/{sessionId} written; active_sessions deleted
        │
        ▼
   Daily Cloud Function closes stale sessions (no heartbeat 6+ hours) not explicitly clocked out
```

---

## 2. Session Close Time — `sessionCloseMs` (SINGLE SOURCE OF TRUTH)

**RULE:** Any client-side code that derives elapsed time from local buffers **MUST** close a session's open segments with `sessionCloseMs(buf, isActive, now)` from `src/lib/parseBuffer.ts`, then pass the result as `parseBuffer`'s `nowMs` arg.

- **Active session only** (`buf.sessionId === sessionId && displayState !== 'clocked-out'`) → extends to `now`.
- **Every other buffer** → closes at its `clock-out` event, or — if it has none (abandoned/orphaned session) — at its **last recorded event**.

**Why:** Without this, a clock-out-less buffer's open working segment is counted all the way to `now`, inflating totals and rendering as a phantom "live, working" session while the user is clocked out.

**Consumers:** both today-views, via `todaySessionCloseMs` in `useTodaySessions.ts` (see §2b) — `TodayTimeline.tsx` (timeline bars + per-row totals) and `useDayTotal.ts` (the "TODAY" total).

**ANTI-PATTERN:** Do **not** call `parseBuffer(buf.events, Date.now())` directly over a set of buffers.

### Total-worked invariant
`useDayTotal` and `TodayTimeline`'s *Total worked* **MUST stay in sync**: both sum `workingSeconds + breakSeconds` (**idle and pause excluded**). The "TODAY" figure on the timer page is **required to equal** the timesheet's *Total worked* exactly. They now share `todaySessionWorkedSeconds`, so the invariant holds by construction rather than by two matching copies of the arithmetic.

---

## 2b. Today's Views Are Multi-Device — `useTodaySessions`

> `src/hooks/useTodaySessions.ts`. The **only** source `useDayTotal` and `TodayTimeline` may read.

The local IndexedDB buffer holds sessions tracked on **this device only**. A user who clocks out on device A and later clocks in on device B has both sessions on the server — `time_entries` is keyed by uid — but only the second one locally. A local-only read therefore showed device B a day missing all of device A's hours ("TODAY" at `00:00:00`, *"No active session today"*), while the admin timesheet and analytics showed both. `UserTimesheet` deliberately excludes today, so nothing else covered the gap.

`useTodaySessions(timezone)` merges the two sources and de-duplicates by `sessionId` (the ledger doc id **is** the session id, so the match is exact):

| Case | Winner | Why |
|---|---|---|
| Live session | **local buffer** | Still growing; no ledger doc exists until clock-out |
| Ledger doc **with** an event log | **ledger** | The committed record — and for a session tracked here it was written from this very buffer |
| Ledger doc with an **empty** log | **local buffer** | A placeholder awaiting exactly this buffer's upload (§3b) — the ledger's zeroes are not yet the truth |
| Buffer with no ledger doc | local buffer | Not yet uploaded (crash pending reconciliation) |

- The ledger half comes from `useTimesheetData(null, today, today, tz)`, so it shares the 5-min sessionStorage cache, the `invalidateTimesheetCache` calls already made on clock-in/out, and an **in-flight dedupe** added to that hook — the timer page mounts the hook twice (`useDayTotal` + `TodayTimeline`) and must still cost **one** query (rule 9).
- **RULE — derive every today total from `todaySessionWorkedSeconds`.** It closes open segments with `todaySessionCloseMs` (which delegates to `sessionCloseMs`, adding only the empty-log case where the ledger's `endTime` is the sole boundary) and falls back to stored aggregates when `events` is empty.
- **An empty event log is *unknown*, never "worked the whole span"** (analytics trap 1). A manual entry contributes its stored hours and draws one synthesised working bar (trap 7); an interrupted session the CF closed with zeroes contributes 0 and draws an empty track. Never measure `endTime − startTime` to fill the hole.
- `TodayTimeline` must not render *"No active session today"* while the ledger is still loading, or a session from another device flashes as absent before arriving.

---

## 3. Crash / Restart Robustness

| Mechanism | Behavior |
|---|---|
| **Soft clock-out appends a real `clock-out` event** | `TimeTrackingContext.clockOutAndFlush` — appends to the buffer, then marks `active_sessions.userClockOut = true`, then drops the timer to `clocked-out`. Makes the buffer self-describing — can never render as live even if later orphaned. It is exposed on the context and is the **single path for every session that ends without a Clock Out press**: app close, pre-update install, a **displaced (multiple-session) logout** (`AuthWrapper` awaits it before `signOut` — see [auth.md](auth.md#single-active-session)), and a **manual sign-out** (`sidebar/NavUser.tsx`). It early-returns when already `clocked-out`, so it is free to call on any sign-out path. |
| **The clock-out route is session-scoped** | `/api/time-tracking/clock-out` takes an optional `sessionId` and **no-ops on a mismatch**. `active_sessions` is keyed by uid, so a displaced device whose session the new device has already resumed must not clock out a session it no longer owns. |
| **Hydration gated by `isHydrating`** | Exposed on the context. On startup, pending-buffer reconciliation is `await`ed and the Clock In button is disabled until it finishes. Prevents an impatient click from starting a second session that races the in-flight upload and orphans the old buffer. |
| **`startTracking` reconciles, never blindly discards** | When `/start` returns `alreadyActive`, it commits a matching local buffer (`silentLogUpload` → `commitSession`, which writes `time_entries` **and** deletes the `active_sessions` doc). It only `/discard`s when there is genuinely **no** local buffer (session started on another device) — and `/discard` no longer destroys anything (see §3b). |
| **Display self-heal** | The 1s timer tick freezes when the main thread is blocked (e.g. heavy page load). A `visibilitychange`/`focus` listener recomputes elapsed from `entryStartTime + Date.now()` to snap the display back. |
| **Sleep-gap patch is sample-confirmed** | The heartbeat infers OS sleep from a gap > `SLEEP_GAP_THRESHOLD_MS` (20 min) and injects `pause`/`resume` to exclude it. It is now a **safety net for a `suspend` that never reached the renderer** — when the event does arrive, `idle-start` already brackets the sleep and `inWorkingSegment` skips this path. Before patching, it confirms with `wasAwakeDuring()`. |
| **Soft clock-out semantics** | App close is a deliberate soft clock-out — reopening **never** auto-resumes a gracefully-closed session; it commits it and shows a toast. Orphaned server-side sessions are cleaned by the daily Cloud Function; the client does **not** force-delete server sessions during hydration. |

### 3b. Never Delete a Session Whose Event Log Lives on Another Device

**The event log exists in exactly one place until it is uploaded: the IndexedDB of the device that recorded it.** Any server-side path that removes an `active_sessions` doc without leaving something in `time_entries` for that log to land on **destroys a real shift** — the owning device's next `/upload-log` finds neither an active session nor a ledger doc and answers `discarded`.

The path that hit this: device A closes the app without pressing Clock Out (a **soft clock-out** — it sets `userClockOut: true` and leaves the buffer local), the user clocks in on device B, and device A's session is gone before its log was ever uploaded.

**RULE — reserve, don't delete.** Both displacing paths now write `buildInterruptedLedgerDoc` (`activeSessionService.ts`) first — `status: 'interrupted'`, empty `eventLog`, **zeroed** aggregates, `didNotClockOut: true` — the same placeholder `cleanupStaleSessions` writes, so device A's later upload lands on the merge branch and fills in the real hours.

| Path | Behavior |
|---|---|
| `/api/time-tracking/start` | On overwriting a `userClockOut: true` doc, reserves the displaced session in the ledger **inside the same transaction** (reads the ledger doc before any write, per Firestore's reads-before-writes rule). This is the path a second-device clock-in actually takes — no `/discard` is involved. |
| `/api/time-tracking/discard` | `interruptActiveSession` instead of `deleteActiveSession` (which no longer exists). Reserves, then deletes the active doc, atomically. |

- Neither path ever infers aggregates from the session's span — an empty log is *unknown* (analytics trap 1). They stay 0 until the real log merges in.
- Both **skip the write when a ledger doc already exists**: the session may have been committed or already closed by the CF, and overwriting would wipe a real event log.
- Both call `markAnalyticsDirty` — they are ledger-writing paths.
- `buildInterruptedLedgerDoc` **mirrors `cleanupStaleSessions` in `functions/index.js`** — change both together.
- **`/upload-log` is authorization-scoped.** The `sessionId` is client-supplied and `updateSessionLog` rewrites a doc's event log and totals wholesale, so `getLedgerSessionMeta` returns the owner and status: a doc owned by another uid is **403**, and a `status: 'completed'` doc returns `already-committed` without merging — its log was written at clock-out and a replayed upload must not rewrite settled hours.

### 3c. A Transition Must Never Be Gated on the Network

**RULE — write the event, apply the local state, *then* sync the server. Never `await` the `transition` call in a way that can skip a state update.**

`/api/time-tracking/transition` only updates `active_sessions.currentState`/`lastUpdated` — presence bookkeeping for the admin Active Users view. **The event log is the source of truth**, and it is uploaded wholesale at clock-out. A transient failure of that request must therefore cost nothing.

Every transition once ran:

```ts
sessionBaseSecondsRef.current += segmentSeconds;
await Promise.all([
  appendEvent(sid, { type: 'idle-start', timestamp: Date.now() }),
  apiCall('transition', 'POST', { transition: 'idle' }),   // ← rejects
]);
setEntryStartTime(null);      // never ran
setDisplayState('idle');      // never ran
```

`Promise.all` rejects on the network half while the IndexedDB write still lands, so the log said `idle` and the renderer went on ticking as `working`. Two compounding failures follow, and **the second is the damaging one**:

1. **Elapsed time double-counts.** The pre-idle segment is credited to `sessionBaseSecondsRef` *and* keeps accruing through a stale `entryStartTime`, so the display reads `base + (now − clock-in)`. Crossing 8h then doubles `computeBreakAllowance` — a 45-min allowance renders as 1:30 and the `startBreak` guard hands out break nobody earned. The ledger is unaffected (`/stop` re-derives from the log), so the giveaway is **the timer disagreeing with "Total worked" right below it**.
2. **Recovery dies.** The idle-resume poll (`IDLE_RESUME_CHECK_MS`, 5s) and the `unlock`/`resume` power handler *both* only run while `displayState === 'idle'`. With the renderer stuck on `working`, nothing is left to write the matching `idle-end`. A spurious idle that should self-correct in five seconds instead runs to the next clock-out — banking real work as idle and scoring every screenshot in it **0% activity**.

`syncTransition(transition)` in `TimeTrackingContext.tsx` is the only sanctioned caller. It is fire-and-forget and reports failures to Sentry (`area: 'time-tracking'`, `reason: 'transition-sync-failed'`) — they were previously silent `console.error`s, which is how **~43h of mislabelled time across 9 users accumulated unnoticed over 45 days**.

Two supporting disciplines:

- **Append the event first.** If `appendEvent` throws, the transition aborts having changed nothing, so log and display still agree — the safe failure direction.
- **Set `displayStateRef`/`entryStartTimeRef` eagerly**, ahead of the React commit. `isTransitioningRef` is released the instant the block exits, and the power-event handler reads the refs — it must not see a stale `working`.

**Detecting historical damage:** the heartbeat only appends `activity` while `displayState === 'working'`, so an `activity` event *inside* an idle/break/pause span proves the renderer never entered that state. That fingerprint is what makes old desynced spans machine-identifiable.

### 3d. `reconcileLogState` — the Desync Watchdog

The same fingerprint, evaluated live. `reconcileLogState(sid)` compares `stateAtMs(buf.events, now)` against `displayStateRef.current`; when the renderer claims `working` over a log that says otherwise, **the log wins** and the renderer is moved to *its* state.

Called from the **idle poll's working branch** (every `IDLE_CHECK_INTERVAL_MS`, bounding a desync at 30s) and from the **heartbeat**, immediately before it appends the `activity` event that would strand the session. The heartbeat call is the only coverage for `enableIdleTimeout: false` users — the idle poll does not run for them at all.

**RULE — heal backwards, never forwards.** The watchdog does **not** write a closing event. Writing `idle-end` at `now` would assert the user resumed at that instant, which is exactly what is not known. Landing the renderer in `idle` hands the question to the resume poll, which reads `getIdleTime()` and closes the span at a timestamp the OS can justify. Totals are rebased with `parseBuffer(events, boundaryMs)` — closing at the **boundary that opened the stranded state**, not at `now`, which is what excludes the span from working time rather than banking it. `on-break` additionally needs `breakStartTime` set to that boundary or the tick's break branch is inert and the countdown freezes.

It reports every repair to Sentry (`reason: 'log-renderer-desync'`, with the stranded duration and the opener's `trigger`). **It should never fire.** If it does, a transition path is still gated on something it should not be.

### 3e. Returning From Idle Is the Load-Bearing Guarantee

The `lock` heuristic is retained deliberately (§4) on the strength of one property: **a wrongly-entered idle must end the moment real input reappears.** Three things deliver it, and none may be weakened without revisiting the lock policy:

| Mechanism | Latency |
|---|---|
| Idle-resume poll — `getIdleTime() < IDLE_THRESHOLD_SECONDS` | ≤ `IDLE_RESUME_CHECK_MS` (5s) |
| `resume`/`unlock` power events — immediate re-check, no waiting for the poll | instant |
| `reconcileLogState` → resume poll (pathological desync only) | ≤ 35s |

- **`backgroundThrottling: false` on the main window ([`electron/main.js`](../electron/main.js)) is load-bearing, not an optimisation.** Chromium throttles timers in hidden renderers to ~1/minute after 5 minutes; a minimised app — the normal state for this fleet — would degrade the 5s resume poll to a minute or worse. The flag is what keeps "the moment activity is detected" true. Never remove it.
- **Turning `enableIdleTimeout` off while a user sits in `idle` would strand them there**, because the resume poll is the only exit and it is about to stop existing. The idle effect returns them to `working` first (`trigger: 'idle-tracking-disabled'`).
- **Residual risk, outside the app's reach:** `getSystemIdleTime()` is an OS counter. Input delivered to an elevated-privilege window (Windows `GetLastInputInfo`) or arriving over a remote-control session may not reset it, in which case a genuinely working user reads as idle and will *not* auto-resume. No app-side logic fixes that — it needs the affected machine identified.

**RULE — a heartbeat gap alone must never erase worked time.** The heartbeat period (15 min) sits only 5 min under `SLEEP_GAP_THRESHOLD_MS` (20 min), so a throttled timer or a stalled network call can overshoot it while the machine was awake and the user was working. `wasAwakeDuring(from, to)` settles it with evidence: the native sampler ticks every 5s in the main process, so samples spanning the gap **prove** the machine was running and the patch is skipped; a hole (> `SAMPLE_GAP_TOLERANCE_MS`) means it genuinely slept. It is deliberately conservative — it returns `false` (patch, i.e. legacy behavior) whenever it cannot prove wakefulness: no sampler on older builds, samples aged out of the 45-min retention, or IPC failure.

---

## 4. Activity Percent (Screenshots & Active Users)

### Current method (event-log fallback — active across all clients)
`activityPercent` is derived from the session event log by comparing `workingSeconds` vs `idleSeconds` within each screenshot window (`TimeTrackingContext.tsx` → `calcActivityPercent`).

**Limitation:** coarse. The tracker only flips to `idle` after 15 minutes without input (`IDLE_THRESHOLD_SECONDS`), so low-input periods under that threshold register as **100% active**.

### Preferred method (powerMonitor input samples) — now wired, feature-detected
The screenshot upload path in `TimeTrackingContext.tsx` **prefers** the sample-based calculation (`calcActivityPercentFromSamples`) when `window.electronAPI.timeTracking.getActivitySince` is exposed, and **falls back** to the event-log method otherwise. No full-rollout gate is needed — each client uses the best method it has. It buckets the window into 1-minute slots and marks each slot active if any keyboard/mouse input occurred — measured at the OS level via `powerMonitor.getSystemIdleTime()`.

Two rules govern it:

**RULE — the sample method returns `null`, never `0`, when it cannot answer.** An empty sample array means *no coverage* (the main process restarted, or the window predates the 45-min `SAMPLE_RETENTION_MS`) — it does **not** mean the user was inactive; the sampler ticks every 5s regardless of input. Returning `0` there reports a fully active user as completely inactive **and** silently skips the fallback, since the call site re-arms it on `null` alone. Any future edit must preserve the `null` contract.

**RULE — only working minutes count toward the denominator.** Slots where the event log says the session was `idle`/`on-break`/`paused` are excluded (via `stateAtMs`), mirroring the event-log method's `working / (working + idle)`. `windowStart` is the *previous screenshot*, so a window can span a long break or idle stretch; counting those minutes against the user caps the score far below reality (a 30-min break inside a 45-min window drags a fully active user to ~36%). The window is also clamped to the earliest available sample, so retention limits shrink the scored span rather than deflating the score.

The call site fetches the event log once and feeds it to both methods (it supplies the sample method's denominator and drives the fallback outright):

```ts
let activityPercent: number | null = null;
if (electronAPI.timeTracking.getActivitySince) {
  try {
    const samples = await electronAPI.timeTracking.getActivitySince(windowStart);
    activityPercent = calcActivityPercentFromSamples(samples, windowStart, windowEnd, events);
  } catch {
    // Non-critical — fall through to the event-log method
  }
}
if (activityPercent === null && events.length > 0) {
  activityPercent = calcActivityPercent(events, windowStart, windowEnd);
}
```

- IPC handler wired in `electron/main.js` (`timeTracking:getActivitySince`), exposed via `electron/preload.js`; type in `src/types/electron.d.ts`.
- **Runtime selection:** the call site prefers samples when `getActivitySince` is present and falls back to the event-log method when it is absent *or* returns `null`.

### Absence of a value is not 0 — and not 100

`activityPercent` is produced **only** by the screenshot upload path (`/api/time-tracking/screenshots/upload` → `updateActivityPercent` → `active_sessions.lastActivityPercent`), and that route hard-returns 403 when `enableScreenshots` is false. So for a screenshots-disabled user the field **never exists**, and for anyone else it is absent until the session's first capture lands (scheduled at a random offset within `SCREENSHOT_WINDOW_MS`, so up to 15 min).

**RULE — never substitute a number for a missing `lastActivityPercent`.** `AdminActiveUsers` previously rendered `lastActivityPercent ?? 100`, which showed every screenshots-off user as a permanently full 100% bar — an invented figure indistinguishable from a real measurement. Render the absence instead.

To let the UI separate the two absences, **`active_sessions.enableScreenshots` is stamped at clock-in** by `/api/time-tracking/start` (from the 60s-cached `getUserById`, so it is normally a free read). `useActiveUsers` maps it with `data.enableScreenshots !== false`, so sessions predating the field read as `true` (unknown → assume on → "No data yet"). The three render states are:

| Condition | Rendered |
|---|---|
| `enableScreenshots === false` | "Screenshots off" |
| enabled, `lastActivityPercent == null` | "No data yet" |
| enabled, value present | `Progress` bar + `N%` |

It is a **snapshot at clock-in**, not live — an admin toggling `enableScreenshots` mid-session does not update it. That matches the client, which also reads `enableScreenshots` once at hydration (`TimeTrackingContext` ← `/api/time-tracking/status`), so the stamp and the capture behaviour stay consistent for the life of a session.

### Native session boundaries (screen lock / system suspend)
The main process forwards `powerMonitor` `suspend`/`lock-screen`/`unlock-screen`/`resume` as a `power:event` IPC (`electron/preload.js` → `electronAPI.power.onEvent`), each carrying the native timestamp `at`. `TimeTrackingContext` stamps events at `at` rather than `Date.now()`, so boundaries are exact. Feature-detected — no-ops on Electron builds that don't forward power events.

| Event | Behavior |
|---|---|
| `suspend` | **Immediate idle**, `idle-start` stamped at the suspend instant. The machine is stopping, so no work can happen past it — this also brackets the sleep exactly, which is why the resume side needs no gap patch (idle is excluded from worked time). |
| `lock` | **Confirmed, not trusted.** Only transitions to idle when `getIdleTime() < LOCK_CONFIRM_IDLE_SECONDS` (60s). |
| `resume` / `unlock` | Re-checks `getIdleTime()` and returns to `working` immediately if under threshold, instead of waiting up to `IDLE_RESUME_CHECK_MS` (5s). A **check, not an assumption** — the OS idle counter can read high right after a resume, in which case the idle-resume poll handles it. |

**Every `idle-start` records which producer fired it** — `meta: { trigger: 'poll' | 'suspend' | 'lock' }` — because the three carry very different confidence: the poll has 15 minutes of measured silence behind it, `suspend` is certain, and `lock` is only the heuristic below. `idle-end` is tagged the same way (`'poll' | 'resume' | 'unlock'`), and user-initiated `pause`/`resume`/`break-end` carry `trigger: 'user'`.

**The `lock` heuristic has a measured false-positive problem.** Of the 332 `idle-start` events in a 30-day sample with screenshot evidence covering the required quiet window, **147 (44%) were poll-impossible** — a capture 0–6 minutes earlier scored 68–100% activity, so the 15-minute silence the poll requires demonstrably did not happen. Those can only have come from the power-event path, and since captures continued through them the machine was not suspended. Before the §3c fix these were catastrophic (nothing ended them); after it they self-correct within `IDLE_RESUME_CHECK_MS`. **The `trigger` tag exists to settle whether the residual rate justifies tightening or retiring the `lock` path** — until enough tagged logs accumulate, that remains unquantified per-producer.

**RULE — never trust a bare `lock` as "user is away".** macOS fires `lock-screen` on screensaver activation, and a screensaver by definition only starts *after* an inactivity timeout, so it carries no new information about presence. Acting on it marks a user who is reading on-screen idle at their screensaver timeout (often 5 min) instead of the real 15-min threshold. Only a lock preceded by recent input (`< LOCK_CONFIRM_IDLE_SECONDS`) means the user deliberately locked and walked away; everything else is left to the normal idle poll. `powerSaveBlocker` is `prevent-display-sleep` only and does **not** suppress screensaver locks.

### Clock-out flush on app close
The main process holds the window `close` (the single choke-point for both the X button and Cmd/Ctrl-Q) until the renderer's `clockOutAndFlush` finishes and calls `electronAPI.app.closingFlushed()`, or a 4s hard timeout elapses. This ensures the `/api/time-tracking/clock-out` POST completes instead of being killed mid-flight.

---

## 5. Analytics (admin dashboard)

> `/admin-portal/shift-management` → **Analytics** tab. Individual / group / company-wide views over up to 90 days.

### Why rollups, not live queries

**There is no Firestore index that supports querying `time_entries` without `userId`.** Company-wide analytics read live would mean chunked `userId in [...]` fan-out across the whole roster — thousands of doc reads on every dashboard load, violating cross-cutting rule 9. Instead a nightly Cloud Function collapses each user-day into one small document.

```
time_entries + screenshots ──► rollupDailyAnalytics (04:00 UTC, functions/rollup.js)
                                        │
                                        ▼
                          analytics_daily/{userId}_{YYYY-MM-DD}
                                        │
      /api/admin/analytics/timetracking ┤ folds rollups + expanded shifts server-side
                                        ▼
                         useAnalyticsData → the Analytics tab
```

### Firestore

- `analytics_daily/{userId}_{date}` — one precomputed doc per user per **local** day. Type: `AnalyticsDailyDocument`.
- `analytics_dirty/{userId}_{date}` — recompute queue, drained each CF run.
- Both are **Admin-SDK-only** (`allow read, write: if false`). These docs aggregate the whole company's hours — a client-readable rule here would be a data leak.
- Index: `analytics_daily` on `userId ASC, date ASC`. Company scope uses a single-field `date` range (no composite needed).

### The Cloud Function

`rollupDailyAnalytics` — `onSchedule('0 4 * * *', UTC)` in `functions/index.js`; compute lives in `functions/rollup.js`.

- **04:00 UTC** is deliberate: after `cleanupStaleSessions` (02:00) so orphaned sessions are already ledgered, and after `syncPagePermissions` (03:00) so `permittedPageIds` is settled before enumerating users.
- Recomputes a **3-day rolling window** of each user's local dates `[today-3 .. today-1]`. This is what makes a fixed UTC schedule timezone-agnostic: a UTC−11 user's "yesterday" hasn't ended at 04:00 UTC, so it's recomputed correctly on a later run. **Never computes the current local day** — partial data.
- **Idempotent by construction**: full recompute + `set()`, never merge/increment. (`computedAt` is a serverTimestamp, so it differs between runs — exclude it when diffing.)
- Recomputes user-days through a **bounded pool (`ROLLUP_CONCURRENCY = 8`)**, not serially — each user-day is two independent range queries plus a write, and at full roster the serial version was ~3N sequential round-trips inside the 540s timeout. The cap is what keeps it an async fan-out rather than a write burst; raise it only with the 500/50/5 ramp in mind.
- Drains `analytics_dirty` **after** the recompute, so a crash re-queues rather than dropping work. The drain is a `bulkWriter()` — a repeatedly written-and-emptied queue is a contiguous-key-range delete, so batches were the wrong tool.

### Backfill

`node src/scripts/backfill-analytics-rollups.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--user=<uid>] [--dry-run] [--force]`

It `require`s the same `functions/rollup.js` module as the CF, so backfilled and live docs are identical. It is also the **migration tool**: bump `version` in the schema and re-run over the affected range.

### Timezone semantics

- **A day is defined in the user's own timezone** (`users/{uid}.timezone` → ledger `timezone` → `UTC`).
- **`users/{uid}.timezone` is `''` until onboarding fills it in.** `ensureUserExists` seeds an empty string, and only the onboarding profile step (or Settings → App Settings) resolves a real IANA zone. An empty or otherwise invalid zone makes `Intl` throw `RangeError`, so **default it with `|| 'UTC'`, never `?? 'UTC'`** — `''` is not nullish and sails straight through `??`. Both `timezone.ts` and `functions/rollup.js` now funnel every zone through `safeTimezone()` as a backstop, but call sites should still use `||` so the intent is visible. *(This was a live bug: one un-onboarded user with a shift 500'd company-wide, their group, and their own scope in the Analytics tab.)*
- **A session is attributed wholly to the local date of its `startTime`** — no midnight splitting. Matches `AdminTimesheets` and keeps overnight shifts + event logs intact.
- **The company's "2026-07-14" is the union of every member's local 2026-07-14**, not a single UTC interval. This is what makes daily docs summable across mixed timezones, and it is stated in the UI.
- DST: a local day is 23h or 25h. On a 25h day `hourBuckets` folds the repeated hour into one bucket — one hour per year per user.

### Aggregation rules (do not violate)

1. **Means never sum.** Store sum + count (`activitySum`/`activityCount`) and divide at read time. Averaging per-day averages weights a 20-minute day the same as an 8-hour one.
2. **Distributions travel as histograms** (`activityHistogram`) — histograms sum, percentiles don't.
3. **Ratios are ratios-of-sums**, never means-of-ratios (`fragmentationRatio` = Σinterruptions / Σhours).
4. **`segments` is stored flat** — Firestore has no nested arrays. Use `decodeSegments()` / `decodeSessionBounds()`.
5. **Adherence is computed at read time** from `segments` + `sessionBounds` against expanded shifts, so editing a shift retroactively fixes adherence with **no rollup recompute**.

### Metric definitions

| Metric | Definition |
|---|---|
| Focus block | A maximal uninterrupted `working` segment ≥ `FOCUS_BLOCK_MIN_SECONDS` (1500s / 25 min). `activity`/`screenshot` events don't break one. |
| `interruptionCount` | `idle-start` + `break-start` + **user** `pause` events. Synthetic sleep-gap pauses excluded (see traps). |
| `fragmentationRatio` | `interruptionCount / (workingSeconds/3600)` — interruptions per working hour. |
| `focusRatio` | `focusSecondsInBlocks / workingSeconds`. |
| Break allowance | Mirrors `computeBreakAllowance`: `(floor(workingSeconds/28800)+1) * 2700`. Utilisation = Σbreak / Σallowance. |
| `noBreakDay` | `workingSeconds >= 4h && breakSeconds === 0`. |
| Consecutive days | Doc presence with `workingSeconds > 0`. The API fetches **7 extra days before `start`** as a streak seed — without it a streak crossing the range boundary is truncated. |
| Punctuality | `onTime / (onTime + late)`, thresholds `ON_TIME_BEFORE_MS` 15min / `LATE_AFTER_MS` 30min. |
| Unrostered overtime | `(working + break) − worked inside the MERGED union of shift windows`, floored at 0. Merging prevents overlapping shifts double-counting. |
| Coverage heatmap | Σ`hourBuckets` by local weekday × local hour. |

### Traps (all verified against source)

1. **An empty `eventLog` means "unknown", NOT "100% working".** `computeWorkedInWindow` (`sessionSegments.ts:136-138`) and `sessionToSegments` (`:26-34`) both treat an empty log as one full working segment — but `cleanupStaleSessions` writes `workingSeconds: 0` **with** an empty log, which is the default state of every crashed session until the client reopens. The rollup **skips** `status === 'interrupted' && eventLog.length === 0` and records the span as `unknownSeconds`. Feeding those docs to the helpers would claim the entire session span as work.
2. **`pause` has two meanings.** `patchSleepGap` injects a synthetic `pause`/`resume` pair to exclude machine sleep, so `pauseSeconds` conflates user pauses with sleep. The rollup accumulates the synthetic pair into `asleepSeconds` and **excludes it from `interruptionCount`** — a laptop sleeping is not an interruption to focus. `patchSleepGap` now stamps `meta: { trigger: 'sleep-gap' }` at the injection site and `findSyntheticPauses` treats that tag as authoritative; the old timestamp heuristic (stamped at exactly `prevEvent.timestamp + 1000`, `resume` > `SLEEP_GAP_THRESHOLD_MS` later) survives **only** as the fallback for logs written before the tag existed. Do not remove it — historical `time_entries` still depend on it.
3. **`didNotClockOut` is never cleared on merge.** `updateSessionLog` sets `status: 'completed'` but leaves `didNotClockOut: true`. **Discriminate on `status`, never on `didNotClockOut`.**
4. **`logUploadedAt` is not a watermark.** `commitSession` sets it to a client-clock `Timestamp.fromMillis(endTimeMs)`; `updateSessionLog` uses `serverTimestamp()`. Use the dirty queue.
5. **The ledger's `pauseSeconds` under-reports.** `parseBuffer` discards `pauseStart` on `resume` without accumulating it (`parseBuffer.ts:99-105`), so the stored value only ever counts a pause that was *never resumed*. **Verified**: for a work→pause(30m)→resume→break(10m) log, `parseBuffer` reports `pauseSeconds: 0` where the real paused time was 1800s. The rollup therefore derives all four totals from the event log — `working`/`idle`/`break` match the ledger exactly, and `pauseSeconds` becomes correct rather than under-reported.
6. **Screenshots are one doc per SCREEN.** Every screen in a `captureGroup` carries the same `activityPercent`, so counting rows double-weights multi-monitor users in both the mean and the histogram. The rollup dedupes by `captureGroup`; `screenshotCount` counts **captures**, not images.
7. **Manual entries** (`isManual: true`) legitimately have no event log. The rollup trusts their stored aggregates and synthesises one working span so adherence/coverage still credit them, but excludes them from focus metrics — there is no event data to judge focus from.
8. **Archived users' rollups are retained** so history stays correct; the read path filters them from current-roster views (`isArchived !== true`).
9. **A single user can 500 an aggregate scope.** The analytics route folds the whole roster in one request, so any per-user throw takes down company-wide *and* every group containing that user, while sibling scopes stay green — a "some groups, some users" failure pattern is the signature of one poison-pill user, not a broken query. Empty `timezone` was the first instance (see Timezone semantics). Guard per-user data at the point of use.

### Findings — investigated, not yet actioned

- **`activityPercent` is two different metrics mixed at the per-capture level.** `TimeTrackingContext.tsx:819-829` prefers native 5s `powerMonitor` samples, but `calcActivityPercentFromSamples` returns `null` whenever the sample buffer can't answer (main process restarted, window predates the 45-min retention, no working slots) — and the caller then silently falls back to the coarse event-log method. **The method therefore varies per screenshot, not per Electron build**, so it cannot be inferred from `appVersion` even in principle (`appVersion` lives only on `active_sessions`, which is deleted at clock-out). The two are now closer in semantics — both exclude idle/break/pause from the denominator — but still diverge sharply below the 15-min idle threshold: a user reading on-screen for 10 minutes scores **100% by event-log and ~0% by samples**. **Cross-user activity comparisons are unsound until an `activityMethod: 'samples' | 'eventlog'` field is stamped on `ScreenshotDocument`** (one string per capture, no migration). The dashboard caveats this in the UI; the fix is cheap and worth doing before anyone acts on activity numbers.
- ~~**`SessionEvent.meta` is defined but populated at zero call sites.**~~ **Done** — `patchSleepGap` tags its synthetic pair `{ trigger: 'sleep-gap' }` (trap 2) and every state event now records its producer (§4). **Only logs written from this build forward carry tags**, so any analysis over `meta` must treat an absent tag as *unknown* and keep the pre-existing fallback, never read it as a distinct category.
- **A historical repair is possible but not yet run.** Desynced spans are machine-identifiable by the `activity`-inside-a-non-working-span fingerprint (§3c), so a backfill could reclassify those stretches as working and re-run the affected `analytics_daily` rollups via `analytics_dirty`. The 45-day sample found ~43h across 9 users. Left undone deliberately: it rewrites settled hours, which is a payroll decision rather than an engineering one.
- **Integrity + fleet analytics** (deliberately out of scope): `modifications[]` + `originalData` support a per-admin edit audit (who adjusted whose hours, by how much, and why); `isManual` and `didNotClockOut` rates are payroll-risk signals; `appVersion`/`platform` on `active_sessions` give an update-adoption curve — valuable precisely because Electron updates are manual; `captureGroup` + `screenIndex` implicitly record each user's monitor count and when it changes.
- **Fidelity limits of rollups.** Intra-day activity percentiles are approximated by the decile histogram (±5% at bucket boundaries); cross-day and cross-user percentiles remain exact because every daily doc is fetched. Any new metric requires a `version` bump + backfill re-run. **Group history is as-of-now, not as-of-then**: moving a user between groups retroactively re-attributes their history (this is what people expect from "show me the CA team's last 90 days", and the UI says so).
- **Interpretation caveat.** Activity % measures *input*, not value — reading, calls, and thinking all register as inactive. The dashboard surfaces a distribution rather than a bare mean and frames it as a coverage/wellbeing signal, deliberately not a ranking.

---

## 6. Session Walkthrough (admin timesheets)

> `/admin-portal/shift-management` → **Timesheets** → click any segment on a day bar. Renders the session's verbatim `eventLog` on a timeline spanning its start to its end.

```
GET /api/time-tracking/entries
  ├── entries[]   — segment rows (the day bars)            ← sessionToSegments
  └── sessions[]  — whole ledger docs + raw eventLog       ← the walkthrough
```

- **The event log rides along on the existing read.** The entries route already fetches the very `time_entries` docs the dialog needs, and Firestore bills per *document*, not per field — so `sessions[]` costs **zero** extra reads. **Never add a per-session fetch on dialog open**; it would spend a read to re-fetch data the page already had (cross-cutting rule 9).
- `SegmentRow.sessionId` is what maps a clicked bar segment back to its session. Every segment carries it, including the logless fallback row.
- **`eventsToSegments(events, startMs, endMs)` in `sessionSegments.ts` is the shared decomposition core**, used by `sessionToSegments` (server, day bars) and the dialog (client, ribbon). Change it once; the two views cannot drift.
  - It returns **`[]` for an empty log** — "no events" is *unknown*, not "worked the whole span" (trap 1). `sessionToSegments` keeps its own legacy full-working fallback so the day bars still draw something; the dialog renders the same absence honestly, as a grey hatch labelled "no event log".
- **Totals in the dialog are derived from the event log, not the ledger.** The stored `pauseSeconds` under-reports (trap 5), so a ledger-sourced strip would contradict the ribbon directly above it.
- **Times are rendered in the *viewer's* timezone** (`useUserData().timezone`, the admin reading the page), not the tracked user's, and the zone is named in the header so the two can never be confused. Every zone goes through `safeTimezone()`.
- Event copy and colours live in `EVENT_META` in the dialog; colours are read from `STATE_CONFIG` — never re-type a state hex (DESIGN.md). Events split into **milestones** (state boundaries, always shown) and **routine markers** (`activity`, `screenshot` — shown by default, hideable).
- The bar is **opt-in interactive**: `TimesheetView` only makes segments clickable when a `sessions` prop is supplied. The employee's own timesheet (`UserTimesheet`) omits it and stays read-only.
- The timesheet sessionStorage cache key is **`bluu_timesheet_v2`** — bumped when `sessions` joined the payload. **Any future change to the entries payload shape needs another bump**, or warm caches render a stale/empty walkthrough.

---

## 7. The Always-Visible Timer Widget

> macOS menu-bar tray title, or a small docked HUD above the Windows system tray. Native mechanics live in [electron.md](electron.md#session-timer-widget-tray-title--docked-hud); what follows is the part that belongs to *this* subsystem.

Per-user toggle in Settings → App Settings (`users/{uid}.timerWidgetEnabled`, **default on** — absent means enabled, so read it `!== false`).

**RULE — the widget receives an anchor, never an elapsed value.** The push is `{ mode, baseSeconds, anchorMs }`; the shell re-derives the displayed number every second using the same arithmetic the 1s tick in §2 runs. This is what makes the widget the *same* clock as the page rather than a copy of it — a per-second string would drift the moment a message is dropped, and would freeze exactly when the renderer's tick freezes (the failure the `visibilitychange`/`focus` self-heal in §3 exists to paper over).

The mapping mirrors the tick branch for branch, which is the whole point:

| `displayState` | Widget | Sourced from |
|---|---|---|
| `working` | counts **up** | `sessionBaseSecondsRef` + `entryStartTime` |
| `on-break` | counts the **break allowance down** | `computeBreakAllowance(base) − breakUsedSecondsRef`, anchored at `breakStartTime` |
| `idle`, `paused` | **stopped**, holding `sessionBaseSecondsRef` | the same value the page renders for those states |
| `clocked-out` | **destroyed** | — |

- **The push effect must stay inside `TimeTrackingProvider`.** It is the only scope holding `sessionBaseSecondsRef`, `breakUsedSecondsRef`, `entryStartTime` and `breakStartTime` — the actual derivation inputs. A consumer reading the context sees `elapsedSeconds`, a number that is already one tick old, and can therefore only push a *copy*.
- Its deps are the **transitions** (`displayState`, `entryStartTime`, `breakStartTime`, the toggle), not `elapsedSeconds` — depending on the latter would fire an IPC every second and defeat the anchor entirely.
- The break countdown recomputes `allowanceAtStart` from the same two refs the tick's break branch reads, in the same commit, so the two agree by construction rather than by two matching copies of the arithmetic (the same discipline as the total-worked invariant in §2).
- It is torn down on provider unmount as well as on clock-out — a widget outliving its provider would tick on against a session nobody holds.

## Gotchas Checklist

- [ ] Never `parseBuffer(events, Date.now())` over a buffer set — always close with `sessionCloseMs` first.
- [ ] Never read today's totals from local buffers alone — go through `useTodaySessions`, or a second device shows a day with hours missing.
- [ ] Never remove an `active_sessions` doc without reserving the session in `time_entries` — its event log may still be sitting on another device (§3b).
- [ ] Never trust a client-supplied `sessionId` into `updateSessionLog` — check owner **and** status first.
- [ ] Any new path that signs a user out mid-session must `await clockOutAndFlush()` first — a sign-out never reaches the Clock Out button. Current paths: `AuthWrapper` (displaced), `sidebar/NavUser.tsx` (manual).
- [ ] Keep `useDayTotal` and `TodayTimeline` *Total worked* summing `workingSeconds + breakSeconds` only.
- [ ] After clock-in/out, call `invalidateTimesheetCache(uid)`.
- [ ] A "second active session" is a client buffer bug — check hydration/`isHydrating`, not the server.
- [ ] Timer widget: push an **anchor**, never an elapsed number, and keep the push inside `TimeTrackingProvider` (§7). Never add `elapsedSeconds` to its deps.
- [ ] Sample-based activity is feature-detected (`getActivitySince`); the event-log method is the fallback.
- [ ] `calcActivityPercentFromSamples` must return `null` (never `0`) when it can't cover the window — `0` both libels an active user and kills the fallback.
- [ ] Never count idle/break/pause minutes in the activity denominator.
- [ ] Never default a missing `lastActivityPercent` to a number — screenshots-off users have no activity value at all. Use `active_sessions.enableScreenshots` to tell "off" from "not captured yet".
- [ ] `active_sessions.lastUpdated` is a **client→server check-in time** (clock-in, state transition, 15-min heartbeat), *not* a last-user-input time — Active Users surfaces it as "Last Synced at" for exactly that reason. Never relabel it as activity/presence.
- [ ] **Never gate a state transition on `/transition`** — append the event, apply local state, then `syncTransition()` fire-and-forget (§3c). Awaiting it strands the renderer out of step with the log and kills idle recovery.
- [ ] Set `displayStateRef`/`entryStartTimeRef` eagerly in a transition, not just the React state — `isTransitioningRef` releases before the commit lands.
- [ ] Tag every new state event with `meta.trigger`, and treat an **absent** tag as unknown (pre-existing logs have none).
- [ ] Never trust a bare `lock` as "away" — confirm with `getIdleTime()` first (screensavers fire it). Measured false-positive rate is high; the policy is retained **only** because §3e guarantees a fast return from idle.
- [ ] Never remove `backgroundThrottling: false` from the main window — it is what keeps the 5s idle-resume poll running while the app is minimised (§3e).
- [ ] Never lengthen `IDLE_RESUME_CHECK_MS` or add an await in front of the resume poll without revisiting the `lock` policy that depends on it.
- [ ] The desync watchdog heals **backwards** (renderer → log's state), never by inventing a closing event (§3d).
- [ ] Never patch a heartbeat gap without confirming sleep via `wasAwakeDuring()` — the gap alone erases real work.
- [ ] **Analytics:** never feed an empty-`eventLog` session to `sessionToSegments`/`computeWorkedInWindow` — they read it as 100% working. Skip it and record `unknownSeconds`.
- [ ] **Analytics:** discriminate crashed sessions on `status`, never on `didNotClockOut` (never cleared on merge).
- [ ] **Analytics:** never store a mean in a rollup — store sum + count, divide at read time.
- [ ] **Analytics:** dedupe screenshots by `captureGroup` before averaging — one doc per screen, not per capture.
- [ ] **Analytics:** any new ledger-writing path must call `markAnalyticsDirty` or that day's rollup goes stale.
- [ ] **Analytics:** `functions/rollup.js` mirrors `sessionToSegments`, `computeBreakAllowance` and `timezone.ts` — change both sides together (including `safeTimezone`).
- [ ] Never default a user timezone with `?? 'UTC'` — it is seeded as `''`, which is not nullish. Use `|| 'UTC'`.
- [ ] **Walkthrough:** never fetch a session's event log on dialog open — it already arrived with `/entries` for free.
- [ ] **Walkthrough:** bump the `bluu_timesheet_v*` cache key whenever the entries payload shape changes.
- [ ] **Walkthrough:** `eventsToSegments` returning `[]` means *unknown*, not zero worked time — present the absence, never a full working span.
