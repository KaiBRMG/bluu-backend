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
| `src/hooks/useTimeTracking.ts` | Hook surface over the context |
| `src/hooks/useDayTotal.ts` | The "TODAY" total |
| `src/components/timesheet/TodayTimeline.tsx` | Timeline bars + per-row totals |
| `src/hooks/useTimesheetData.ts` | Timesheet cache (5 min TTL) |
| API: `src/app/api/time-tracking/*/route.ts` | `start`, `stop`, `clock-out`, `discard`, `heartbeat`, `transition`, `status`, `upload-log`, `entries`, `screenshots/*` |
| `electron/main.js`, `electron/preload.js` | `timeTracking:getActivitySince` IPC (powerMonitor) |
| `src/types/electron.d.ts` | `electronAPI.timeTracking.getActivitySince` type |
| Cloud Function (`functions/`) | Daily stale-session cleanup |

## Firestore

- `active_sessions/{userId}` — keyed by **uid**, so a user can only ever have **one** server-side active session. **"Two active sessions" symptoms are ALWAYS a client-side rendering/buffer issue, never two server docs.** Deleted on clock-out.
- `time_entries/{sessionId}` — permanent ledger written at clock-out.

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

**Consumers:** `TodayTimeline.tsx` (timeline bars + per-row totals) and `useDayTotal.ts` (the "TODAY" total).

**ANTI-PATTERN:** Do **not** call `parseBuffer(buf.events, Date.now())` directly over a set of buffers.

### Total-worked invariant
`useDayTotal` and `TodayTimeline`'s *Total worked* **MUST stay in sync**: both sum `workingSeconds + breakSeconds` (**idle and pause excluded**). The "TODAY" figure on the timer page is **required to equal** the timesheet's *Total worked* exactly.

---

## 3. Crash / Restart Robustness

| Mechanism | Behavior |
|---|---|
| **App close appends a real `clock-out` event** | In `TimeTrackingContext.clockOutAndFlush`, before marking `active_sessions.userClockOut = true`. Makes the buffer self-describing — can never render as live even if later orphaned. |
| **Hydration gated by `isHydrating`** | Exposed on the context. On startup, pending-buffer reconciliation is `await`ed and the Clock In button is disabled until it finishes. Prevents an impatient click from starting a second session that races the in-flight upload and orphans the old buffer. |
| **`startTracking` reconciles, never blindly discards** | When `/start` returns `alreadyActive`, it commits a matching local buffer (`silentLogUpload` → `commitSession`, which writes `time_entries` **and** deletes the `active_sessions` doc). It only `/discard`s when there is genuinely **no** local buffer (session started on another device). |
| **Display self-heal** | The 1s timer tick freezes when the main thread is blocked (e.g. heavy page load). A `visibilitychange`/`focus` listener recomputes elapsed from `entryStartTime + Date.now()` to snap the display back. |
| **Sleep-gap patch is sample-confirmed** | The heartbeat infers OS sleep from a gap > `SLEEP_GAP_THRESHOLD_MS` (20 min) and injects `pause`/`resume` to exclude it. It is now a **safety net for a `suspend` that never reached the renderer** — when the event does arrive, `idle-start` already brackets the sleep and `inWorkingSegment` skips this path. Before patching, it confirms with `wasAwakeDuring()`. |
| **Soft clock-out semantics** | App close is a deliberate soft clock-out — reopening **never** auto-resumes a gracefully-closed session; it commits it and shows a toast. Orphaned server-side sessions are cleaned by the daily Cloud Function; the client does **not** force-delete server sessions during hydration. |

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

### Native session boundaries (screen lock / system suspend)
The main process forwards `powerMonitor` `suspend`/`lock-screen`/`unlock-screen`/`resume` as a `power:event` IPC (`electron/preload.js` → `electronAPI.power.onEvent`), each carrying the native timestamp `at`. `TimeTrackingContext` stamps events at `at` rather than `Date.now()`, so boundaries are exact. Feature-detected — no-ops on Electron builds that don't forward power events.

| Event | Behavior |
|---|---|
| `suspend` | **Immediate idle**, `idle-start` stamped at the suspend instant. The machine is stopping, so no work can happen past it — this also brackets the sleep exactly, which is why the resume side needs no gap patch (idle is excluded from worked time). |
| `lock` | **Confirmed, not trusted.** Only transitions to idle when `getIdleTime() < LOCK_CONFIRM_IDLE_SECONDS` (60s). |
| `resume` / `unlock` | Re-checks `getIdleTime()` and returns to `working` immediately if under threshold, instead of waiting up to `IDLE_RESUME_CHECK_MS` (5s). A **check, not an assumption** — the OS idle counter can read high right after a resume, in which case the idle-resume poll handles it. |

**RULE — never trust a bare `lock` as "user is away".** macOS fires `lock-screen` on screensaver activation, and a screensaver by definition only starts *after* an inactivity timeout, so it carries no new information about presence. Acting on it marks a user who is reading on-screen idle at their screensaver timeout (often 5 min) instead of the real 15-min threshold. Only a lock preceded by recent input (`< LOCK_CONFIRM_IDLE_SECONDS`) means the user deliberately locked and walked away; everything else is left to the normal idle poll. `powerSaveBlocker` is `prevent-display-sleep` only and does **not** suppress screensaver locks.

### Clock-out flush on app close
The main process holds the window `close` (the single choke-point for both the X button and Cmd/Ctrl-Q) until the renderer's `clockOutAndFlush` finishes and calls `electronAPI.app.closingFlushed()`, or a 4s hard timeout elapses. This ensures the `/api/time-tracking/clock-out` POST completes instead of being killed mid-flight.

---

## 5. Analytics (admin dashboard)

> `/admin/shift-management` → **Analytics** tab. Individual / group / company-wide views over up to 90 days.

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
- Drains `analytics_dirty` **after** the recompute, so a crash re-queues rather than dropping work.

### Backfill

`node src/scripts/backfill-analytics-rollups.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--user=<uid>] [--dry-run] [--force]`

It `require`s the same `functions/rollup.js` module as the CF, so backfilled and live docs are identical. It is also the **migration tool**: bump `version` in the schema and re-run over the affected range.

### Timezone semantics

- **A day is defined in the user's own timezone** (`users/{uid}.timezone` → ledger `timezone` → `UTC`).
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
2. **`pause` has two meanings.** `patchSleepGap` injects a synthetic `pause`/`resume` pair to exclude machine sleep, so `pauseSeconds` conflates user pauses with sleep. The rollup detects the synthetic pair (stamped at exactly `prevEvent.timestamp + 1000`, with its `resume` > `SLEEP_GAP_THRESHOLD_MS` later), accumulates it into `asleepSeconds`, and **excludes it from `interruptionCount`** — a laptop sleeping is not an interruption to focus. **This is a heuristic**; the durable fix is tagging `meta: { trigger: 'sleep-gap' }` at the injection site (`findSyntheticPauses` already honours the tag when present).
3. **`didNotClockOut` is never cleared on merge.** `updateSessionLog` sets `status: 'completed'` but leaves `didNotClockOut: true`. **Discriminate on `status`, never on `didNotClockOut`.**
4. **`logUploadedAt` is not a watermark.** `commitSession` sets it to a client-clock `Timestamp.fromMillis(endTimeMs)`; `updateSessionLog` uses `serverTimestamp()`. Use the dirty queue.
5. **The ledger's `pauseSeconds` under-reports.** `parseBuffer` discards `pauseStart` on `resume` without accumulating it (`parseBuffer.ts:99-105`), so the stored value only ever counts a pause that was *never resumed*. **Verified**: for a work→pause(30m)→resume→break(10m) log, `parseBuffer` reports `pauseSeconds: 0` where the real paused time was 1800s. The rollup therefore derives all four totals from the event log — `working`/`idle`/`break` match the ledger exactly, and `pauseSeconds` becomes correct rather than under-reported.
6. **Screenshots are one doc per SCREEN.** Every screen in a `captureGroup` carries the same `activityPercent`, so counting rows double-weights multi-monitor users in both the mean and the histogram. The rollup dedupes by `captureGroup`; `screenshotCount` counts **captures**, not images.
7. **Manual entries** (`isManual: true`) legitimately have no event log. The rollup trusts their stored aggregates and synthesises one working span so adherence/coverage still credit them, but excludes them from focus metrics — there is no event data to judge focus from.
8. **Archived users' rollups are retained** so history stays correct; the read path filters them from current-roster views (`isArchived !== true`).

### Findings — investigated, not yet actioned

- **`activityPercent` is two different metrics mixed at the per-capture level.** `TimeTrackingContext.tsx:819-829` prefers native 5s `powerMonitor` samples, but `calcActivityPercentFromSamples` returns `null` whenever the sample buffer can't answer (main process restarted, window predates the 45-min retention, no working slots) — and the caller then silently falls back to the coarse event-log method. **The method therefore varies per screenshot, not per Electron build**, so it cannot be inferred from `appVersion` even in principle (`appVersion` lives only on `active_sessions`, which is deleted at clock-out). The two are now closer in semantics — both exclude idle/break/pause from the denominator — but still diverge sharply below the 15-min idle threshold: a user reading on-screen for 10 minutes scores **100% by event-log and ~0% by samples**. **Cross-user activity comparisons are unsound until an `activityMethod: 'samples' | 'eventlog'` field is stamped on `ScreenshotDocument`** (one string per capture, no migration). The dashboard caveats this in the UI; the fix is cheap and worth doing before anyone acts on activity numbers.
- **`SessionEvent.meta` is defined but populated at zero call sites.** Two high-value uses: (a) tag the synthetic pause in `patchSleepGap` with `{ trigger: 'sleep-gap' }`, replacing the timestamp heuristic in trap 2; (b) tag `idle-start` with `{ trigger: 'poll' | 'suspend' | 'lock' }` — there are now **three** producers of differing fidelity (the 30s poll, `suspend` stamping the exact instant, `lock` confirmed against `LOCK_CONFIRM_IDLE_SECONDS`), currently collapsed into one indistinguishable event. That distinction separates "walked away" from "at desk reading" from "closed the laptop".
- **Integrity + fleet analytics** (deliberately out of scope): `modifications[]` + `originalData` support a per-admin edit audit (who adjusted whose hours, by how much, and why); `isManual` and `didNotClockOut` rates are payroll-risk signals; `appVersion`/`platform` on `active_sessions` give an update-adoption curve — valuable precisely because Electron updates are manual; `captureGroup` + `screenIndex` implicitly record each user's monitor count and when it changes.
- **Fidelity limits of rollups.** Intra-day activity percentiles are approximated by the decile histogram (±5% at bucket boundaries); cross-day and cross-user percentiles remain exact because every daily doc is fetched. Any new metric requires a `version` bump + backfill re-run. **Group history is as-of-now, not as-of-then**: moving a user between groups retroactively re-attributes their history (this is what people expect from "show me the CA team's last 90 days", and the UI says so).
- **Interpretation caveat.** Activity % measures *input*, not value — reading, calls, and thinking all register as inactive. The dashboard surfaces a distribution rather than a bare mean and frames it as a coverage/wellbeing signal, deliberately not a ranking.

---

## Gotchas Checklist

- [ ] Never `parseBuffer(events, Date.now())` over a buffer set — always close with `sessionCloseMs` first.
- [ ] Keep `useDayTotal` and `TodayTimeline` *Total worked* summing `workingSeconds + breakSeconds` only.
- [ ] After clock-in/out, call `invalidateTimesheetCache(uid)`.
- [ ] A "second active session" is a client buffer bug — check hydration/`isHydrating`, not the server.
- [ ] Sample-based activity is feature-detected (`getActivitySince`); the event-log method is the fallback.
- [ ] `calcActivityPercentFromSamples` must return `null` (never `0`) when it can't cover the window — `0` both libels an active user and kills the fallback.
- [ ] Never count idle/break/pause minutes in the activity denominator.
- [ ] Never trust a bare `lock` as "away" — confirm with `getIdleTime()` first (screensavers fire it).
- [ ] Never patch a heartbeat gap without confirming sleep via `wasAwakeDuring()` — the gap alone erases real work.
- [ ] **Analytics:** never feed an empty-`eventLog` session to `sessionToSegments`/`computeWorkedInWindow` — they read it as 100% working. Skip it and record `unknownSeconds`.
- [ ] **Analytics:** discriminate crashed sessions on `status`, never on `didNotClockOut` (never cleared on merge).
- [ ] **Analytics:** never store a mean in a rollup — store sum + count, divide at read time.
- [ ] **Analytics:** dedupe screenshots by `captureGroup` before averaging — one doc per screen, not per capture.
- [ ] **Analytics:** any new ledger-writing path must call `markAnalyticsDirty` or that day's rollup goes stale.
- [ ] **Analytics:** `functions/rollup.js` mirrors `sessionToSegments`, `computeBreakAllowance` and `timezone.ts` — change both sides together.
