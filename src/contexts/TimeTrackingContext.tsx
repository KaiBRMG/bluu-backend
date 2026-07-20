'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { TimerDisplayState, LocalSessionBuffer, SessionEvent } from '@/types/firestore';
import { invalidateTimesheetCache } from '@/hooks/useTimesheetData';
import {
  initBuffer,
  appendEvent,
  getBuffer,
  getLastSessionId,
  clearBuffer,
  parseBuffer,
  pruneOldSessions,
} from '@/lib/localBuffer';
import { useUserData } from '@/hooks/useUserData';
import { getAppInfo } from '@/lib/appVersion';
import { markScreenshotBugFixed } from '@/lib/markScreenshotBugFixed';
import { toast } from 'sonner';

const HEARTBEAT_INTERVAL_MS   = 15 * 60 * 1000; // 15 minutes — working state only
const SLEEP_GAP_THRESHOLD_MS  = HEARTBEAT_INTERVAL_MS + 5 * 60 * 1000; // 20 min — gap larger than this implies the process was suspended
const IDLE_CHECK_INTERVAL_MS  = 30_000;          // poll for idle every 30s
const IDLE_RESUME_CHECK_MS    = 5_000;           // poll for resume every 5s
const IDLE_THRESHOLD_SECONDS  = 900;             // 15 minutes without input = idle
const LOCK_CONFIRM_IDLE_SECONDS = 60;            // a `lock` is only "user walked away" if they were active just before it
const SAMPLE_GAP_TOLERANCE_MS = 60_000;          // native sampler ticks every 5s — a hole this big means the process was stopped
const BREAK_DURATION_SECONDS  = 2700;            // 45-minute break allowance per period
const WORK_PERIOD_SECONDS     = 8 * 3600;        // new break period unlocked every 8 hours
const SCREENSHOT_WINDOW_MS    = 15 * 60 * 1000;
const STALE_THRESHOLD_MS      = 15 * 60 * 1000; // 15 minutes — beyond this, don't resume

/** Total break seconds allowed based on how many 8-hour periods have elapsed. */
function computeBreakAllowance(workingSeconds: number): number {
  const periods = Math.floor(workingSeconds / WORK_PERIOD_SECONDS) + 1;
  return periods * BREAK_DURATION_SECONDS;
}

interface TimeTrackingContextType {
  displayState:          TimerDisplayState;
  sessionId:             string | null;
  elapsedSeconds:        number;
  breakRemainingSeconds: number | null;
  breakUsedSeconds:      number;
  breakAllowanceSeconds: number;  // total break seconds allowed so far (grows every 8h)
  startTracking:         () => Promise<void>;
  stopTracking:          () => Promise<void>;
  pauseTracking:         () => Promise<void>;
  resumeFromPause:       () => Promise<void>;
  startBreak:            () => Promise<void>;
  endBreak:              () => Promise<void>;
  clockOutAndFlush:      () => Promise<void>;
  isLoading:             boolean;
  isHydrating:           boolean;
}

const TimeTrackingContext = createContext<TimeTrackingContextType | null>(null);

/**
 * Compute activity % for a screenshot window by comparing working vs idle
 * seconds parsed from the session event log. parseBuffer accumulates totals
 * up to a given moment, so the window's totals are the difference between
 * snapshots at windowEnd and windowStart.
 */
function calcActivityPercent(
  events: SessionEvent[],
  windowStart: number,
  windowEnd: number,
): number {
  const eventsToEnd = events.filter(e => e.timestamp <= windowEnd);
  const eventsToStart = events.filter(e => e.timestamp <= windowStart);
  const totalsAtEnd = parseBuffer(eventsToEnd, windowEnd);
  const totalsAtStart = parseBuffer(eventsToStart, windowStart);

  const working = Math.max(0, totalsAtEnd.workingSeconds - totalsAtStart.workingSeconds);
  const idle = Math.max(0, totalsAtEnd.idleSeconds - totalsAtStart.idleSeconds);
  const denominator = working + idle;
  if (denominator === 0) return 100;
  return Math.round((working / denominator) * 100);
}

/**
 * Did the machine stay awake for the whole span? The native sampler ticks every
 * 5s in the main process, so a dense run of samples across the span proves the
 * machine was running; a hole means it was suspended.
 *
 * Deliberately conservative — returns `false` whenever it cannot prove
 * wakefulness (no sampler on older builds, samples aged out of the 45-min
 * retention, IPC failure), which preserves the legacy sleep-gap behaviour.
 */
async function wasAwakeDuring(fromMs: number, toMs: number): Promise<boolean> {
  const api = typeof window !== 'undefined' ? window.electronAPI?.timeTracking : undefined;
  if (!api?.getActivitySince) return false;
  try {
    const sampleTimes = (await api.getActivitySince(fromMs))
      .map(s => s.sampleMs)
      .sort((a, b) => a - b);
    if (sampleTimes.length === 0) return false;
    // Samples must cover the span end to end, with no hole big enough to hide a suspend.
    if (sampleTimes[0] - fromMs > SAMPLE_GAP_TOLERANCE_MS) return false;
    if (toMs - sampleTimes[sampleTimes.length - 1] > SAMPLE_GAP_TOLERANCE_MS) return false;
    for (let i = 1; i < sampleTimes.length; i++) {
      if (sampleTimes[i] - sampleTimes[i - 1] > SAMPLE_GAP_TOLERANCE_MS) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** The tracked state at a given moment, per the session event log. */
function stateAtMs(events: SessionEvent[], ms: number): TimerDisplayState {
  let state: TimerDisplayState = 'clocked-out';
  for (const e of events) {
    if (e.timestamp > ms) break;
    switch (e.type) {
      case 'clock-in':
      case 'resume':
      case 'idle-end':
      case 'break-end':  state = 'working';     break;
      case 'idle-start': state = 'idle';        break;
      case 'break-start': state = 'on-break';   break;
      case 'pause':      state = 'paused';      break;
      case 'clock-out':  state = 'clocked-out'; break;
      // 'activity' / 'screenshot' are markers — they don't change state
    }
  }
  return state;
}

/**
 * Preferred method — compute activity % from powerMonitor idle-time samples
 * (native, per-minute granularity). Buckets the window into 1-minute slots and
 * marks each slot active if any OS-level keyboard/mouse input occurred in it.
 *
 * Only minutes the user was actually expected to be working count toward the
 * denominator — idle/break/pause minutes are excluded, mirroring the event-log
 * method's `working / (working + idle)`. Without this a long break or idle
 * stretch inside the window mathematically caps the result far below reality.
 *
 * Returns `null` when the sample buffer can't answer for this window (the main
 * process restarted, or the window predates the 45-min sample retention).
 * `null` — never 0 — is what lets callers fall back to the event-log method;
 * returning 0 here would report a fully active user as completely inactive.
 */
function calcActivityPercentFromSamples(
  samples: Array<{ sampleMs: number; idleSeconds: number }>,
  windowStart: number,
  windowEnd: number,
  events: SessionEvent[] = [],
): number | null {
  if (samples.length === 0) return null;

  // Samples are retained for a rolling window in the main process, so they may
  // not reach back to windowStart. Score only the span they actually cover.
  const earliestSampleMs = Math.min(...samples.map(s => s.sampleMs));
  const effectiveStart = Math.max(windowStart, earliestSampleMs);
  if (windowEnd - effectiveStart < 60_000) return null; // too short to score

  const slotCount = Math.ceil((windowEnd - effectiveStart) / 60_000);
  const workingSlots = new Set<number>();
  for (let slot = 0; slot < slotCount; slot++) {
    const slotMidMs = effectiveStart + slot * 60_000 + 30_000;
    if (events.length === 0 || stateAtMs(events, slotMidMs) === 'working') {
      workingSlots.add(slot);
    }
  }
  if (workingSlots.size === 0) return null; // nothing to score — let the fallback decide

  const activeSlots = new Set<number>();
  for (const { sampleMs, idleSeconds } of samples) {
    const lastActiveMs = sampleMs - idleSeconds * 1000;
    if (lastActiveMs >= effectiveStart && lastActiveMs < windowEnd) {
      const slot = Math.floor((lastActiveMs - effectiveStart) / 60_000);
      if (workingSlots.has(slot)) activeSlots.add(slot);
    }
  }
  return Math.round((activeSlots.size / workingSlots.size) * 100);
}

export function useTimeTrackingContext(): TimeTrackingContextType {
  const ctx = useContext(TimeTrackingContext);
  if (!ctx) throw new Error('useTimeTrackingContext must be used within a TimeTrackingProvider');
  return ctx;
}

export function TimeTrackingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { userData } = useUserData();

  const [displayState, setDisplayState]                 = useState<TimerDisplayState>('clocked-out');
  const [sessionId, setSessionId]                       = useState<string | null>(null);
  const [entryStartTime, setEntryStartTime]             = useState<number | null>(null);
  const [breakStartTime, setBreakStartTime]             = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds]             = useState(0);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState<number | null>(null);
  const [breakUsedSeconds, setBreakUsedSeconds]         = useState(0);
  const [breakAllowanceSeconds, setBreakAllowanceSeconds] = useState(BREAK_DURATION_SECONDS);
  const [isLoading, setIsLoading]                       = useState(false);
  const [isHydrating, setIsHydrating]                   = useState(true);
  const [enableScreenshots, setEnableScreenshots]       = useState(false);

  // Cumulative working seconds across the session (restored from buffer on crash recovery)
  const sessionBaseSecondsRef = useRef(0);
  // Cumulative break seconds used this session (restored from buffer on crash recovery)
  const breakUsedSecondsRef = useRef(0);

  // Refs that mirror volatile state — used inside interval callbacks
  const displayStateRef  = useRef(displayState);
  const sessionIdRef     = useRef(sessionId);
  const entryStartTimeRef = useRef(entryStartTime);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { entryStartTimeRef.current = entryStartTime; }, [entryStartTime]);

  const heartbeatRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCheckRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef              = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotTimeoutRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveScreenshotFailsRef = useRef(0);
  // TEMPORARY (see CLAUDE.md): guards the one-time stale-TCC reset to once per session.
  const tccResetAttemptedRef          = useRef(false);
  const isTransitioningRef            = useRef(false);
  const hasHydratedRef       = useRef(false);
  const sessionStartMsRef    = useRef<number | null>(null);
  const prevScreenshotMsRef  = useRef<number | null>(null);

  const apiCall = useCallback(async (path: string, method: 'GET' | 'POST' = 'POST', body?: object) => {
    const idToken = await user?.getIdToken();
    if (!idToken) throw new Error('Not authenticated');
    const res = await fetch(`/api/time-tracking/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return res.json();
  }, [user]);

  /**
   * Retroactively exclude a span the machine was asleep: inject pause/resume
   * around it and rebase the running totals so the sleep isn't counted as work.
   */
  const patchSleepGap = useCallback(async (sid: string, pauseAtMs: number, resumeAtMs: number) => {
    await appendEvent(sid, { type: 'pause', timestamp: pauseAtMs });
    await appendEvent(sid, { type: 'resume', timestamp: resumeAtMs });
    const patchedBuf = await getBuffer(sid);
    if (!patchedBuf) return;
    const totals = parseBuffer(patchedBuf.events);
    sessionBaseSecondsRef.current = totals.workingSeconds;
    breakUsedSecondsRef.current   = totals.breakSeconds;
    // Update the ref immediately so the next tick uses the correct base;
    // setEntryStartTime keeps React state consistent and restarts the tick.
    entryStartTimeRef.current = resumeAtMs;
    setEntryStartTime(resumeAtMs);
    setElapsedSeconds(totals.workingSeconds);
  }, []);

  // ─── Session retention: prune old flushed sessions once per app load ─
  const hasPrunedRef = useRef(false);
  useEffect(() => {
    if (!user || hasPrunedRef.current) return;
    hasPrunedRef.current = true;
    const timezone = userData?.timezone || 'UTC';
    pruneOldSessions(timezone).catch(() => {});
  }, [user, userData?.timezone]);

  // ─── Startup: hydrate from server + handle pending buffers ──────────
  useEffect(() => {
    if (!user || hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    setIsHydrating(true);

    (async () => {
      try {

        const [data, lastSessionId] = await Promise.all([
          apiCall('status', 'GET'),
          getLastSessionId(),
        ]);

        setEnableScreenshots(data.enableScreenshots ?? false);

        if (data.session && !data.session.userClockOut) {
          const lastUpdatedMs = new Date(data.session.lastUpdated).getTime();
          const isFresh = Date.now() - lastUpdatedMs < STALE_THRESHOLD_MS;

          if (isFresh) {
            // Case B: active session within 15 min — transparent resume
            const sid = data.session.sessionId;
            setSessionId(sid);

            // Reconstruct elapsed from local buffer if available
            const buf = await getBuffer(sid);
            if (buf) {
              const totals = parseBuffer(buf.events);
              sessionBaseSecondsRef.current = totals.workingSeconds;
              breakUsedSecondsRef.current = totals.breakSeconds;
              setBreakUsedSeconds(totals.breakSeconds);
              setBreakAllowanceSeconds(computeBreakAllowance(totals.workingSeconds));
            }

            const state = data.session.currentState;
            if (state === 'working' || state === 'idle') {
              setEntryStartTime(Date.now());
              setDisplayState(state);
            } else if (state === 'on-break') {
              setBreakStartTime(Date.now());
              setDisplayState('on-break');
            } else if (state === 'paused') {
              setDisplayState('paused');
            }
            return; // Done — session resumed
          }
          // Case C: stale session (> 15 min) — fall through to buffer reconciliation
        }

        // Case A (no/closed active session) or Case C (stale): don't resume.
        // Reconcile any orphaned local buffer by uploading it. We AWAIT this so
        // the Clock In button stays disabled (isHydrating) until reconciliation
        // finishes — otherwise an impatient click could start a second session
        // that races with this upload and orphans the old buffer.
        if (lastSessionId) {
          const buf = await getBuffer(lastSessionId);
          if (buf) {
            const action = await silentLogUpload(buf);
            if (action === 'committed' || action === 'log-merged') {
              toast.info('Your previous session was saved when the app closed. Clock in to continue.');
            }
          }
        }
      } catch (err) {
        console.error('[TimeTracking] Hydration failed:', err);
      } finally {
        setIsHydrating(false);
      }
    })();
  }, [user, apiCall]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Upload a local buffer; clear it unless the server discarded it.
   * Returns the server action ('committed' | 'log-merged' | 'discarded') or
   * null on failure, so callers can react (e.g. notify the user a session was
   * saved, or know the buffer was orphaned and left in place).
   */
  const silentLogUpload = useCallback(async (buf: LocalSessionBuffer): Promise<string | null> => {
    try {
      const res = await apiCall('upload-log', 'POST', { buffer: buf });
      if (res.action !== 'discarded') {
        await clearBuffer(buf.sessionId);
      }
      return res.action ?? null;
    } catch (err) {
      console.error('[TimeTracking] Silent log upload failed:', err);
      return null;
    }
  }, [apiCall]);

  /**
   * Soft clock-out: append a real clock-out event to the local buffer, mark the
   * server session userClockOut, and drop the timer to 'clocked-out'.
   *
   * Used by every path that ends a session without an explicit Clock Out press:
   * app close, pre-update install, and a displaced (multiple-session) logout.
   * The local buffer is left in IndexedDB and uploaded on the next startup.
   */
  const clockOutAndFlush = useCallback(async () => {
    if (displayStateRef.current === 'clocked-out') return;

    const sid = sessionIdRef.current;
    try {
      // Append a clock-out event to the local buffer so it is self-describing:
      // its open segment closes at this timestamp instead of being left open.
      // This guarantees the session never renders as "live" (extending to now)
      // on the next startup, even if the server-side reconciliation below fails
      // or the buffer is later orphaned by a race.
      if (sid) {
        await appendEvent(sid, { type: 'clock-out', timestamp: Date.now() }).catch(() => {});
      }

      const idToken = await user?.getIdToken();
      if (idToken) {
        // Mark active_sessions.userClockOut = true so startup knows not to resume.
        // sessionId scopes the write: active_sessions is keyed by uid, so a
        // displaced device must not clock out a session the new device now owns.
        await fetch('/api/time-tracking/clock-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ sessionId: sid }),
        });
        // Local buffer is preserved in IndexedDB — uploaded on next startup
      }
    } catch (err) {
      console.error('[TimeTracking] Clock-out flush failed:', err);
    } finally {
      // Drop the timer regardless: the session is over on this client either way,
      // and the buffer already carries the clock-out event.
      displayStateRef.current = 'clocked-out';
      setDisplayState('clocked-out');
      setSessionId(null);
      setEntryStartTime(null);
      setBreakStartTime(null);
      setBreakRemainingSeconds(null);
      if (user) invalidateTimesheetCache(user.uid);
    }
  }, [user]);

  // Reset on logout
  useEffect(() => {
    if (!user) {
      hasHydratedRef.current = false;
      setIsHydrating(false);
      setDisplayState('clocked-out');
      setSessionId(null);
      setEntryStartTime(null);
      setBreakStartTime(null);
      setElapsedSeconds(0);
      setBreakRemainingSeconds(null);
      setBreakUsedSeconds(0);
      setBreakAllowanceSeconds(BREAK_DURATION_SECONDS);
      setEnableScreenshots(false);
      sessionBaseSecondsRef.current = 0;
      breakUsedSecondsRef.current = 0;
      sessionStartMsRef.current = null;
      prevScreenshotMsRef.current = null;
    }
  }, [user]);

  // ─── App-close / pre-update handler (Electron) ──────────────────────
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.onAppClosing) return;

    // On app close, the main process holds the quit until we ack (or a hard
    // timeout elapses). Always signal completion so the quit isn't delayed the
    // full timeout, even if the flush throws.
    electronAPI.onAppClosing(async () => {
      try {
        await clockOutAndFlush();
      } finally {
        electronAPI.app?.closingFlushed?.();
      }
    });

    // Before auto-update installs, flush data then signal ready
    electronAPI.updater?.onBeforeInstall?.call(electronAPI.updater, async () => {
      await clockOutAndFlush();
      electronAPI.updater.readyToInstall?.();
    });

    return () => {
      electronAPI.removeAppClosingListeners();
    };
  }, [clockOutAndFlush]);

  // ─── Heartbeat (working state only) ─────────────────────────────────
  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (displayState === 'working') {
      heartbeatRef.current = setInterval(async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;

        const now = Date.now();

        // Sleep gap detection — safety net for a suspend that never reached the
        // renderer (the power-event handler stamps `idle-start` at the exact
        // suspend instant when it does, and `inWorkingSegment` then skips this).
        //
        // The gap alone is only a guess: the heartbeat period is 15 min and the
        // threshold 20, so a throttled timer or a stalled network call can trip
        // it and erase genuinely worked time. Where the native sampler exists,
        // confirm against it first — it ticks every 5s in the main process, so
        // samples spanning the gap prove the machine was awake and the user's
        // work is real. Absent samples mean it truly slept.
        try {
          const buf = await getBuffer(sid);
          if (buf && buf.events.length > 0) {
            const lastEvent = buf.events.at(-1)!;
            const gap = now - lastEvent.timestamp;
            const inWorkingSegment = !['pause', 'idle-start', 'break-start', 'clock-out'].includes(lastEvent.type);

            if (gap > SLEEP_GAP_THRESHOLD_MS && inWorkingSegment && !(await wasAwakeDuring(lastEvent.timestamp, now))) {
              await patchSleepGap(sid, lastEvent.timestamp + 1000, now);
            }
          }
        } catch {
          // Non-critical — proceed with the normal heartbeat regardless
        }

        appendEvent(sid, { type: 'activity', timestamp: now }).catch(() => {});
        apiCall('heartbeat', 'POST').catch(err => {
          console.error('[TimeTracking] Heartbeat failed:', err);
        });
      }, HEARTBEAT_INTERVAL_MS);
    }

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [displayState, apiCall, patchSleepGap]);

  // ─── Idle Detection ──────────────────────────────────────────────────
  const enableIdleTimeout = userData?.enableIdleTimeout ?? true;

  useEffect(() => {
    if (idleCheckRef.current) {
      clearInterval(idleCheckRef.current);
      idleCheckRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking) return;
    if (!enableIdleTimeout) return;

    if (displayState === 'working') {
      idleCheckRef.current = setInterval(async () => {
        if (isTransitioningRef.current) return;
        if (displayStateRef.current !== 'working') return;
        try {
          const idleTime = await electronAPI.timeTracking.getIdleTime();
          if (idleTime >= IDLE_THRESHOLD_SECONDS) {
            isTransitioningRef.current = true;
            try {
              const sid = sessionIdRef.current;
              if (!sid) return;

              const startTime = entryStartTimeRef.current;
              const segmentSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
              sessionBaseSecondsRef.current += segmentSeconds;

              await Promise.all([
                appendEvent(sid, { type: 'idle-start', timestamp: Date.now() }),
                apiCall('transition', 'POST', { transition: 'idle' }),
              ]);
              setEntryStartTime(null);
              setDisplayState('idle');
            } finally {
              isTransitioningRef.current = false;
            }
          }
        } catch (err) {
          console.error('[TimeTracking] Idle check failed:', err);
          isTransitioningRef.current = false;
        }
      }, IDLE_CHECK_INTERVAL_MS);

    } else if (displayState === 'idle') {
      idleCheckRef.current = setInterval(async () => {
        if (isTransitioningRef.current) return;
        if (displayStateRef.current !== 'idle') return;
        try {
          const idleTime = await electronAPI.timeTracking.getIdleTime();
          if (idleTime < IDLE_THRESHOLD_SECONDS) {
            isTransitioningRef.current = true;
            try {
              const sid = sessionIdRef.current;
              if (!sid) return;

              await Promise.all([
                appendEvent(sid, { type: 'idle-end', timestamp: Date.now() }),
                apiCall('transition', 'POST', { transition: 'resume' }),
              ]);
              setEntryStartTime(Date.now());
              setDisplayState('working');
            } finally {
              isTransitioningRef.current = false;
            }
          }
        } catch (err) {
          console.error('[TimeTracking] Idle resume check failed:', err);
          isTransitioningRef.current = false;
        }
      }, IDLE_RESUME_CHECK_MS);
    }

    return () => {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
    };
  }, [displayState, enableIdleTimeout, apiCall]);

  // ─── Native power/lock events (Electron) ─────────────────────────────
  // Native suspend/resume/lock/unlock carry exact timestamps, so they beat both
  // the 30s idle poll and the heartbeat's gap guess. Feature-detected: no-ops on
  // older Electron builds that don't forward power events.
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.power?.onEvent) return;
    if (!enableIdleTimeout) return;

    /** working → idle, crediting the segment worked up to `atMs`. */
    const goIdle = async (atMs: number) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const startTime = entryStartTimeRef.current;
      const segmentSeconds = startTime ? Math.max(0, Math.floor((atMs - startTime) / 1000)) : 0;
      sessionBaseSecondsRef.current += segmentSeconds;
      await Promise.all([
        appendEvent(sid, { type: 'idle-start', timestamp: atMs }),
        apiCall('transition', 'POST', { transition: 'idle' }),
      ]);
      setEntryStartTime(null);
      setDisplayState('idle');
    };

    electronAPI.power.onEvent(async ({ event, at }) => {
      const atMs = at ?? Date.now();
      try {
        if (event === 'suspend') {
          // The machine is stopping — no work can happen past this instant, so
          // stamping idle-start at `atMs` brackets the sleep exactly. That is
          // what makes the heartbeat's gap guess unnecessary on this path.
          if (isTransitioningRef.current || displayStateRef.current !== 'working') return;
          isTransitioningRef.current = true;
          try { await goIdle(atMs); } finally { isTransitioningRef.current = false; }
          return;
        }

        if (event === 'lock') {
          // A lock only means "walked away" if the user was active right up to
          // it. macOS also fires lock-screen when the screensaver kicks in —
          // which by definition only happens after an inactivity timeout, so it
          // says nothing new about presence. Trusting it blindly marks a user
          // reading on-screen idle at their screensaver timeout (often 5 min)
          // instead of the real 15-min threshold. Let the idle poll judge those.
          if (isTransitioningRef.current || displayStateRef.current !== 'working') return;
          const idleTime = await electronAPI.timeTracking.getIdleTime();
          if (idleTime >= LOCK_CONFIRM_IDLE_SECONDS) return;
          if (isTransitioningRef.current || displayStateRef.current !== 'working') return;
          isTransitioningRef.current = true;
          try { await goIdle(atMs); } finally { isTransitioningRef.current = false; }
          return;
        }

        // 'resume' | 'unlock' ────────────────────────────────────────────
        // Come back instantly instead of waiting up to IDLE_RESUME_CHECK_MS.
        // Must be a check, not an assumption: after a resume the OS idle counter
        // can still read high, in which case the poll handles it.
        if (isTransitioningRef.current || displayStateRef.current !== 'idle') return;
        const idleTime = await electronAPI.timeTracking.getIdleTime();
        if (idleTime >= IDLE_THRESHOLD_SECONDS) return;
        if (isTransitioningRef.current || displayStateRef.current !== 'idle') return;

        isTransitioningRef.current = true;
        try {
          const activeSid = sessionIdRef.current;
          if (!activeSid) return;
          await Promise.all([
            appendEvent(activeSid, { type: 'idle-end', timestamp: Date.now() }),
            apiCall('transition', 'POST', { transition: 'resume' }),
          ]);
          setEntryStartTime(Date.now());
          setDisplayState('working');
        } finally {
          isTransitioningRef.current = false;
        }
      } catch (err) {
        console.error('[TimeTracking] Power-event handling failed:', err);
      }
    });

    return () => {
      electronAPI.power?.removeEventListener();
    };
  }, [enableIdleTimeout, apiCall]);

  // ─── Timer Tick (1s) ─────────────────────────────────────────────────
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    if (displayState === 'clocked-out' || displayState === 'paused') {
      if (displayState === 'clocked-out') { setElapsedSeconds(0); setBreakUsedSeconds(0); }
      setBreakRemainingSeconds(null);
      return;
    }

    if (displayState === 'on-break' && breakStartTime) {
      const allowanceAtStart = computeBreakAllowance(sessionBaseSecondsRef.current) - breakUsedSecondsRef.current;
      const tick = () => {
        const elapsed = Math.floor((Date.now() - breakStartTime) / 1000);
        const remaining = Math.max(0, allowanceAtStart - elapsed);
        setBreakRemainingSeconds(remaining);
        setBreakUsedSeconds(breakUsedSecondsRef.current + elapsed);
        setBreakAllowanceSeconds(computeBreakAllowance(sessionBaseSecondsRef.current));

        if (remaining <= 0) {
          const sid = sessionIdRef.current;
          const now = Date.now();
          if (sid) {
            // Accumulate the break time before auto-ending
            breakUsedSecondsRef.current += Math.floor((now - breakStartTime) / 1000);
            // Auto-end break → transition back to working
            Promise.all([
              appendEvent(sid, { type: 'break-end', timestamp: now }),
              apiCall('transition', 'POST', { transition: 'break-end' }),
            ]).catch(err => console.error('[TimeTracking] Break auto-end failed:', err));
          }
          setBreakStartTime(null);
          setBreakRemainingSeconds(null);
          setEntryStartTime(now);
          setDisplayState('working');
        }
      };
      tick();
      tickRef.current = setInterval(tick, 1000);
      return;
    }

    if ((displayState === 'working' || displayState === 'idle') && entryStartTime) {
      const tick = () => {
        if (displayStateRef.current === 'working') {
          const startTime = entryStartTimeRef.current;
          if (startTime) {
            const currentSegment = Math.floor((Date.now() - startTime) / 1000);
            const totalWorking = sessionBaseSecondsRef.current + currentSegment;
            setElapsedSeconds(totalWorking);
            setBreakAllowanceSeconds(computeBreakAllowance(totalWorking));
          }
        } else {
          setElapsedSeconds(sessionBaseSecondsRef.current);
          setBreakAllowanceSeconds(computeBreakAllowance(sessionBaseSecondsRef.current));
        }
        setBreakUsedSeconds(breakUsedSecondsRef.current);
      };
      tick();
      tickRef.current = setInterval(tick, 1000);
    }

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [displayState, entryStartTime, breakStartTime, apiCall]);

  // ─── Display self-heal on focus / visibility ────────────────────────
  // The 1s tick is throttled or frozen while the main thread is blocked (e.g.
  // a heavy page load) or the window is backgrounded, so the on-screen timer
  // can appear stuck. Elapsed time is always derived from entryStartTime +
  // Date.now(), so recomputing on focus/visibility snaps the display back to
  // the true wall-clock value immediately instead of waiting for the next tick.
  useEffect(() => {
    const recompute = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const state = displayStateRef.current;
      if (state === 'working' && entryStartTimeRef.current) {
        const segment = Math.floor((Date.now() - entryStartTimeRef.current) / 1000);
        const total = sessionBaseSecondsRef.current + segment;
        setElapsedSeconds(total);
        setBreakAllowanceSeconds(computeBreakAllowance(total));
      } else if (state === 'idle' || state === 'paused') {
        setElapsedSeconds(sessionBaseSecondsRef.current);
      }
    };
    document.addEventListener('visibilitychange', recompute);
    window.addEventListener('focus', recompute);
    return () => {
      document.removeEventListener('visibilitychange', recompute);
      window.removeEventListener('focus', recompute);
    };
  }, []);

  // ─── Power Save Blocker (Electron) ──────────────────────────────────
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking?.setPowerSaveBlocker) return;

    const shouldBlock = displayState !== 'clocked-out' && displayState !== 'paused';
    electronAPI.timeTracking.setPowerSaveBlocker(shouldBlock).catch(() => {});

    return () => {
      electronAPI.timeTracking.setPowerSaveBlocker!(false).catch(() => {});
    };
  }, [displayState]);

  // ─── Screenshot Scheduling ───────────────────────────────────────────
  useEffect(() => {
    if (screenshotTimeoutRef.current) {
      clearTimeout(screenshotTimeoutRef.current);
      screenshotTimeoutRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking?.captureScreenshot) return;
    if (!enableScreenshots || displayState !== 'working') return;

    const scheduleNextCapture = (overrideDelayMs?: number) => {
      const delay = overrideDelayMs ?? Math.floor(Math.random() * SCREENSHOT_WINDOW_MS);
      screenshotTimeoutRef.current = setTimeout(async () => {
        if (displayStateRef.current !== 'working') return;

        let failed = false;
        let failureMessage = '';
        let failureContext = '';
        let failureStack: string | undefined;

        try {
          const result = await electronAPI.timeTracking.captureScreenshot();
          if (result.success && result.screens && result.screens.length > 0) {
            consecutiveScreenshotFailsRef.current = 0;
            const idToken = await user?.getIdToken();
            if (idToken) {
              const windowEnd = Date.now();
              const windowStart = prevScreenshotMsRef.current ?? sessionStartMsRef.current ?? windowEnd;

              let activityPercent: number | null = null;
              const sid = sessionIdRef.current;

              // The event log serves both methods: it supplies the sample
              // method's denominator (which minutes were working) and drives the
              // fallback outright.
              let events: SessionEvent[] = [];
              if (sid) {
                try {
                  events = (await getBuffer(sid))?.events ?? [];
                } catch {
                  // Non-critical — proceed without event data
                }
              }

              // Preferred: native per-minute powerMonitor samples (finer than the
              // 15-min idle threshold). Falls back to the event-log method on
              // older Electron builds that don't expose getActivitySince, and
              // whenever the sample buffer can't cover the window.
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

              await fetch('/api/time-tracking/screenshots/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({
                  screens: result.screens,
                  ...(activityPercent !== null && { activityPercent }),
                }),
              });
              prevScreenshotMsRef.current = windowEnd;
              if (sid) {
                appendEvent(sid, { type: 'screenshot', timestamp: Date.now() }).catch(() => {});
              }
              // Notify user via desktop toast (if enabled in preferences)
              if (userData?.notificationPreferences?.screenshotNotifications !== false) {
                electronAPI.notifications?.show({
                  title: 'Bluu Backend',
                  body: 'Screenshot Captured',
                  playSound: false,
                }).catch(() => {});
              }
            }
          } else {
            failed = true;
            failureMessage = result.error ?? 'Screenshot capture failed — check screen recording permissions.';
            failureContext = 'screenshot:capture-failed';
          }
        } catch (err) {
          failed = true;
          failureMessage = err instanceof Error ? err.message : String(err);
          failureStack = err instanceof Error ? err.stack : undefined;
          failureContext = 'screenshot:capture-upload-failed';
        }

        if (failed) {
          const failCount = ++consecutiveScreenshotFailsRef.current;
          console.error(`[TimeTracking] Screenshot failed (attempt ${failCount}/3):`, failureMessage);

          // TEMPORARY (see CLAUDE.md): repair a stale macOS Screen Recording
          // grant left by pre-signing builds. Fire on the FIRST capture failure
          // (not a network failure) so the reset lands before the user is nudged
          // to "enable it in settings" — enabling a stale record does nothing;
          // only the reset makes the next prompt actually stick. Gated to
          // existing users (screenshotBugFixed falsy) so new/healthy installs
          // never re-prompt, and to once per session.
          //
          // Persisting screenshotBugFixed is what makes it once EVER: the ref is
          // only per-session and the flag stays falsy on its own, so without the
          // write every launch would wipe the grant the user just gave and macOS
          // would re-prompt on every start. Set it as soon as the reset fires,
          // not on success — a reset that didn't take won't take on a retry
          // either; that user goes to Settings → App Settings, which bypasses
          // this flag. Feature-detected — no-op on older builds.
          if (
            failureContext === 'screenshot:capture-failed' &&
            !userData?.screenshotBugFixed &&
            !tccResetAttemptedRef.current
          ) {
            tccResetAttemptedRef.current = true;
            electronAPI.permissions?.resetScreenCapture?.().catch(() => {});
            void markScreenshotBugFixed(await user?.getIdToken());
          }

          if (failCount < 3) {
            // Transient failure — retry in 30s without notifying the user
            scheduleNextCapture(30_000);
            return;
          }
          // 3 consecutive failures — notify and reset the counter. The message
          // depends on the cause: a capture failure (empty screens) is a screen-
          // recording permission problem the user must fix in OS settings, but
          // an upload failure is a network issue — telling that user to change
          // OS settings would send them chasing the wrong fix.
          consecutiveScreenshotFailsRef.current = 0;
          const isCaptureFailure = failureContext === 'screenshot:capture-failed';
          electronAPI.notifications?.show({
            title: 'Bluu Backend',
            body: isCaptureFailure
              ? 'Screenshot Failed. Please enable this in your OS settings ASAP.'
              : 'Screenshot Failed. Network Issues.',
            playSound: false,
          }).catch(() => {});
          fetch('/api/bugs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: failureMessage,
              ...(failureStack && { stack: failureStack }),
              context: failureContext,
              uid: user?.uid ?? null,
            }),
          }).catch(() => {});
        }

        scheduleNextCapture();
      }, delay);
    };

    scheduleNextCapture();

    return () => {
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
        screenshotTimeoutRef.current = null;
      }
    };
  }, [displayState, enableScreenshots, user]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const startTracking = useCallback(async () => {
    // Block while hydration is still reconciling a previous session's buffer —
    // starting now would race that upload and orphan the old buffer (it would
    // then render forever as a phantom "live" session in Today's Timesheet).
    if (isLoading || isHydrating || displayState !== 'clocked-out') return;
    setIsLoading(true);
    try {
      // Report the installed desktop version/platform so the backend has a live
      // view of who is on which build (feature-detected; nulls in a browser).
      const { appVersion, platform } = await getAppInfo();
      const startBody = { appVersion, platform };
      const data = await apiCall('start', 'POST', startBody);

      if (data.alreadyActive) {
        // An active session already exists (a previous run on this machine, or
        // another device). Reconcile it before starting fresh: if we hold the
        // local buffer for it, commit that buffer (writes time_entries AND
        // deletes the active_sessions doc) rather than discarding — discarding
        // would lose the worked time and leave the buffer orphaned. Only discard
        // when there is genuinely no local buffer (session started elsewhere).
        const existingBuf = await getBuffer(data.sessionId);
        if (existingBuf) {
          await silentLogUpload(existingBuf);
        } else {
          await apiCall('discard', 'POST');
        }

        let fresh = await apiCall('start', 'POST', startBody);
        if (fresh.alreadyActive) {
          // Reconciliation didn't clear the server session (e.g. upload was
          // discarded due to a mismatch) — force a discard so we can start.
          await apiCall('discard', 'POST');
          fresh = await apiCall('start', 'POST', startBody);
        }

        await initBuffer(fresh.sessionId, user!.uid, fresh.startTime);
        sessionBaseSecondsRef.current = 0;
        breakUsedSecondsRef.current = 0;
        sessionStartMsRef.current = Date.now();
        prevScreenshotMsRef.current = null;
        setBreakAllowanceSeconds(BREAK_DURATION_SECONDS);
        setSessionId(fresh.sessionId);
        setEntryStartTime(Date.now());
        setDisplayState('working');
        if (user) invalidateTimesheetCache(user.uid);
        return;
      }

      await initBuffer(data.sessionId, user!.uid, data.startTime);
      sessionBaseSecondsRef.current = 0;
      breakUsedSecondsRef.current = 0;
      sessionStartMsRef.current = Date.now();
      prevScreenshotMsRef.current = null;
      setBreakAllowanceSeconds(BREAK_DURATION_SECONDS);
      setSessionId(data.sessionId);
      setEntryStartTime(Date.now());
      setDisplayState('working');
      if (user) invalidateTimesheetCache(user.uid);
    } catch (err) {
      console.error('[TimeTracking] Start failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isHydrating, displayState, apiCall, user, silentLogUpload]);

  const stopTracking = useCallback(async () => {
    if (isLoading || displayState === 'clocked-out') return;
    const sid = sessionId;
    if (!sid) return;
    setIsLoading(true);
    try {
      await appendEvent(sid, { type: 'clock-out', timestamp: Date.now() });
      const buf = await getBuffer(sid);
      if (buf) {
        await apiCall('stop', 'POST', { buffer: buf });
        await clearBuffer(sid);
      }
      setDisplayState('clocked-out');
      setSessionId(null);
      setEntryStartTime(null);
      setBreakStartTime(null);
      setBreakRemainingSeconds(null);
      setBreakAllowanceSeconds(BREAK_DURATION_SECONDS);
      sessionBaseSecondsRef.current = 0;
      breakUsedSecondsRef.current = 0;
      sessionStartMsRef.current = null;
      prevScreenshotMsRef.current = null;
      if (user) invalidateTimesheetCache(user.uid);
      // Let the update prompt re-surface on a manual clock-out (see UpdateAvailableBanner).
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('bluu:clocked-out'));
    } catch (err) {
      console.error('[TimeTracking] Stop failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, sessionId, apiCall, user]);

  const pauseTracking = useCallback(async () => {
    if (isLoading || (displayState !== 'working' && displayState !== 'idle')) return;
    const sid = sessionId;
    if (!sid) return;
    setIsLoading(true);
    try {
      // Stop the tick immediately so no further updates race with state changes
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      // Accumulate current working segment before pausing
      if (displayState === 'working' && entryStartTime) {
        const segmentSeconds = Math.floor((Date.now() - entryStartTime) / 1000);
        sessionBaseSecondsRef.current += segmentSeconds;
      }
      setElapsedSeconds(sessionBaseSecondsRef.current);
      await Promise.all([
        appendEvent(sid, { type: 'pause', timestamp: Date.now() }),
        apiCall('transition', 'POST', { transition: 'pause' }),
      ]);
      setEntryStartTime(null);
      setDisplayState('paused');
    } catch (err) {
      console.error('[TimeTracking] Pause failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, sessionId, entryStartTime, apiCall]);

  const resumeFromPause = useCallback(async () => {
    if (isLoading || displayState !== 'paused') return;
    const sid = sessionId;
    if (!sid) return;
    setIsLoading(true);
    try {
      await Promise.all([
        appendEvent(sid, { type: 'resume', timestamp: Date.now() }),
        apiCall('transition', 'POST', { transition: 'resume-from-pause' }),
      ]);
      setEntryStartTime(Date.now());
      setDisplayState('working');
    } catch (err) {
      console.error('[TimeTracking] Resume from pause failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, sessionId, apiCall]);

  const startBreak = useCallback(async () => {
    if (isLoading || displayState !== 'working') return;
    const sid = sessionId;
    if (!sid) return;
    // Block break if the full allowance for the current period has been used
    if (breakUsedSecondsRef.current >= computeBreakAllowance(sessionBaseSecondsRef.current)) return;
    setIsLoading(true);
    try {
      // Stop the tick immediately so no further updates race with state changes
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      // Accumulate current working segment
      if (entryStartTime) {
        const segmentSeconds = Math.floor((Date.now() - entryStartTime) / 1000);
        sessionBaseSecondsRef.current += segmentSeconds;
      }
      setElapsedSeconds(sessionBaseSecondsRef.current);
      await Promise.all([
        appendEvent(sid, { type: 'break-start', timestamp: Date.now() }),
        apiCall('transition', 'POST', { transition: 'break-start' }),
      ]);
      setEntryStartTime(null);
      setBreakStartTime(Date.now());
      setDisplayState('on-break');
    } catch (err) {
      console.error('[TimeTracking] Break start failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, sessionId, entryStartTime, apiCall]);

  const endBreak = useCallback(async () => {
    if (isLoading || displayState !== 'on-break') return;
    const sid = sessionId;
    if (!sid) return;
    setIsLoading(true);
    try {
      const now = Date.now();
      if (breakStartTime) {
        breakUsedSecondsRef.current += Math.floor((now - breakStartTime) / 1000);
      }
      await Promise.all([
        appendEvent(sid, { type: 'break-end', timestamp: now }),
        apiCall('transition', 'POST', { transition: 'break-end' }),
      ]);
      setBreakStartTime(null);
      setBreakRemainingSeconds(null);
      setEntryStartTime(now);
      setDisplayState('working');
    } catch (err) {
      console.error('[TimeTracking] Break end failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, sessionId, breakStartTime, apiCall]);

  const value = useMemo(() => ({
    displayState,
    sessionId,
    elapsedSeconds,
    breakRemainingSeconds,
    breakUsedSeconds,
    breakAllowanceSeconds,
    startTracking,
    stopTracking,
    pauseTracking,
    resumeFromPause,
    startBreak,
    endBreak,
    clockOutAndFlush,
    isLoading,
    isHydrating,
  }), [
    displayState, sessionId, elapsedSeconds, breakRemainingSeconds,
    breakUsedSeconds, breakAllowanceSeconds, startTracking, stopTracking,
    pauseTracking, resumeFromPause, startBreak, endBreak, clockOutAndFlush,
    isLoading, isHydrating,
  ]);

  return (
    <TimeTrackingContext.Provider value={value}>
      {children}
    </TimeTrackingContext.Provider>
  );
}
