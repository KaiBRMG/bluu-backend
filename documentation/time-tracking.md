# Time Tracking

> Event-log session architecture, elapsed-time derivation, crash/restart robustness, and activity-percent calculation. This is the most bug-sensitive subsystem — read the **rules** before touching any elapsed-time code.

## Dependencies / Interacting Files

| File | Role |
|---|---|
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
| **Soft clock-out semantics** | App close is a deliberate soft clock-out — reopening **never** auto-resumes a gracefully-closed session; it commits it and shows a toast. Orphaned server-side sessions are cleaned by the daily Cloud Function; the client does **not** force-delete server sessions during hydration. |

---

## 4. Activity Percent (Screenshots & Active Users)

### Current method (event-log fallback — active across all clients)
`activityPercent` is derived from the session event log by comparing `workingSeconds` vs `idleSeconds` within each screenshot window (`TimeTrackingContext.tsx` → `calcActivityPercent`).

**Limitation:** coarse. The tracker only flips to `idle` after 15 minutes without input (`IDLE_THRESHOLD_SECONDS`), so low-input periods under that threshold register as **100% active**.

### Preferred method (powerMonitor input samples) — pending Electron rollout
Once every desktop client exposes `window.electronAPI.timeTracking.getActivitySince`, revert the screenshot upload path in `TimeTrackingContext.tsx` to the sample-based calculation. It buckets the window into 1-minute slots and marks each slot active if any keyboard/mouse input occurred — measured at the OS level via `powerMonitor.getSystemIdleTime()`.

```ts
/** Compute activity % from powerMonitor idle-time samples between windowStart and windowEnd. */
function calcActivityPercent(
  samples: Array<{ sampleMs: number; idleSeconds: number }>,
  windowStart: number,
  windowEnd: number,
): number {
  const totalSlots = Math.max(1, Math.ceil((windowEnd - windowStart) / 60_000));
  const activeSlots = new Set<number>();
  for (const { sampleMs, idleSeconds } of samples) {
    const lastActiveMs = sampleMs - idleSeconds * 1000;
    if (lastActiveMs >= windowStart && lastActiveMs < windowEnd) {
      activeSlots.add(Math.floor((lastActiveMs - windowStart) / 60_000));
    }
  }
  return Math.round((activeSlots.size / totalSlots) * 100);
}
```

Call site (inside the screenshot capture `useEffect`, after `windowStart`/`windowEnd` are computed):

```ts
let activityPercent: number | null = null;
if (electronAPI.timeTracking.getActivitySince) {
  try {
    const samples = await electronAPI.timeTracking.getActivitySince(windowStart);
    activityPercent = calcActivityPercent(samples, windowStart, windowEnd);
  } catch {
    // Non-critical — proceed without activity data
  }
}
```

- IPC handler already wired in `electron/main.js` (`timeTracking:getActivitySince`), exposed via `electron/preload.js`; type in `src/types/electron.d.ts`.
- **Why swapped out:** older installed Electron builds may not expose `getActivitySince`, so the event-log fallback runs reliably across all clients meanwhile. **Switch back once the Electron rollout is confirmed.**

---

## Gotchas Checklist

- [ ] Never `parseBuffer(events, Date.now())` over a buffer set — always close with `sessionCloseMs` first.
- [ ] Keep `useDayTotal` and `TodayTimeline` *Total worked* summing `workingSeconds + breakSeconds` only.
- [ ] After clock-in/out, call `invalidateTimesheetCache(uid)`.
- [ ] A "second active session" is a client buffer bug — check hydration/`isHydrating`, not the server.
- [ ] Reverting to sample-based activity requires confirmed Electron rollout.
