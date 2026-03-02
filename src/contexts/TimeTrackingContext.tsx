'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { TimerDisplayState, LocalSessionBuffer } from '@/types/firestore';
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

const HEARTBEAT_INTERVAL_MS   = 15 * 60 * 1000; // 15 minutes — working state only
const IDLE_CHECK_INTERVAL_MS  = 30_000;          // poll for idle every 30s
const IDLE_RESUME_CHECK_MS    = 5_000;           // poll for resume every 5s
const IDLE_THRESHOLD_SECONDS  = 900;             // 15 minutes without input = idle
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
  isLoading:             boolean;
}

const TimeTrackingContext = createContext<TimeTrackingContextType | null>(null);

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

  const heartbeatRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCheckRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTransitioningRef = useRef(false);
  const hasHydratedRef    = useRef(false);

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

          // Case C: stale session (> 15 min) — don't resume, but upload buffer
          if (lastSessionId) {
            const buf = await getBuffer(lastSessionId);
            if (buf) {
              silentLogUpload(buf).catch(() => {});
            }
          }
        } else {
          // Case A: no active session. Check for an orphaned local buffer.
          if (lastSessionId) {
            const buf = await getBuffer(lastSessionId);
            if (buf) {
              silentLogUpload(buf).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error('[TimeTracking] Hydration failed:', err);
      }
    })();
  }, [user, apiCall]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Upload a local buffer silently in the background; clear it on success. */
  const silentLogUpload = useCallback(async (buf: LocalSessionBuffer) => {
    try {
      const res = await apiCall('upload-log', 'POST', { buffer: buf });
      if (res.action !== 'discarded') {
        await clearBuffer(buf.sessionId);
      }
    } catch (err) {
      console.error('[TimeTracking] Silent log upload failed:', err);
    }
  }, [apiCall]);

  // Reset on logout
  useEffect(() => {
    if (!user) {
      hasHydratedRef.current = false;
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
    }
  }, [user]);

  // ─── App-close handler (Electron window close) ──────────────────────
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.onAppClosing) return;

    electronAPI.onAppClosing(async () => {
      const state = displayStateRef.current;
      if (state === 'clocked-out') return;

      try {
        const idToken = await user?.getIdToken();
        if (idToken) {
          // Mark active_sessions.userClockOut = true so startup knows not to resume
          await fetch('/api/time-tracking/clock-out', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          });
          // Local buffer is preserved in IndexedDB — uploaded on next startup
        }
      } catch (err) {
        console.error('[TimeTracking] Clock-out on app close failed:', err);
      }
    });

    return () => { electronAPI.removeAppClosingListeners(); };
  }, [user]);

  // ─── Heartbeat (working state only) ─────────────────────────────────
  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (displayState === 'working') {
      heartbeatRef.current = setInterval(() => {
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
  }, [displayState, apiCall]);

  // ─── Idle Detection ──────────────────────────────────────────────────
  useEffect(() => {
    if (idleCheckRef.current) {
      clearInterval(idleCheckRef.current);
      idleCheckRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking) return;

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
  }, [displayState, apiCall]);

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

  // ─── Screenshot Scheduling ───────────────────────────────────────────
  useEffect(() => {
    if (screenshotTimeoutRef.current) {
      clearTimeout(screenshotTimeoutRef.current);
      screenshotTimeoutRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking?.captureScreenshot) return;
    if (!enableScreenshots || displayState !== 'working') return;

    const scheduleNextCapture = () => {
      const delay = Math.floor(Math.random() * SCREENSHOT_WINDOW_MS);
      screenshotTimeoutRef.current = setTimeout(async () => {
        if (displayStateRef.current !== 'working') return;
        try {
          const result = await electronAPI.timeTracking.captureScreenshot();
          if (result.success && result.screens && result.screens.length > 0) {
            const idToken = await user?.getIdToken();
            if (idToken) {
              await fetch('/api/time-tracking/screenshots/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ screens: result.screens }),
              });
              // Note screenshot in local buffer for audit trail
              const sid = sessionIdRef.current;
              if (sid) {
                appendEvent(sid, { type: 'screenshot', timestamp: Date.now() }).catch(() => {});
              }
            }
          }
        } catch (err) {
          console.error('[TimeTracking] Screenshot capture/upload failed:', err);
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
    if (isLoading || displayState !== 'clocked-out') return;
    setIsLoading(true);
    try {
      const data = await apiCall('start', 'POST');

      if (data.alreadyActive) {
        // An active session exists from another device or a previous run.
        // The client has no local buffer for it — discard it and start fresh.
        await apiCall('discard', 'POST');
        const fresh = await apiCall('start', 'POST');
        await initBuffer(fresh.sessionId, user!.uid, fresh.startTime);
        sessionBaseSecondsRef.current = 0;
        breakUsedSecondsRef.current = 0;
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
  }, [isLoading, displayState, apiCall, user]);

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
      if (user) invalidateTimesheetCache(user.uid);
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

  return (
    <TimeTrackingContext.Provider value={{
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
      isLoading,
    }}>
      {children}
    </TimeTrackingContext.Provider>
  );
}
