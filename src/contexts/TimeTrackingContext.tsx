'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { TimerDisplayState } from '@/types/firestore';

const HEARTBEAT_INTERVAL_MS = 60_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const IDLE_RESUME_CHECK_INTERVAL_MS = 5_000;
const IDLE_THRESHOLD_SECONDS = 900; // 15 minutes
const BREAK_DURATION_SECONDS = 2700; // 45 minutes
const SCREENSHOT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes — entries older than this are from a previous session

interface TimeTrackingContextType {
  displayState: TimerDisplayState;
  currentEntryId: string | null;
  elapsedSeconds: number;
  breakRemainingSeconds: number | null;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
  isLoading: boolean;
}

const TimeTrackingContext = createContext<TimeTrackingContextType | null>(null);

export function useTimeTrackingContext(): TimeTrackingContextType {
  const ctx = useContext(TimeTrackingContext);
  if (!ctx) {
    throw new Error('useTimeTrackingContext must be used within a TimeTrackingProvider');
  }
  return ctx;
}

export function TimeTrackingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [displayState, setDisplayState] = useState<TimerDisplayState>('clocked-out');
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);
  const [entryStartTime, setEntryStartTime] = useState<number | null>(null);
  const [breakStartTime, setBreakStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [enableScreenshots, setEnableScreenshots] = useState(false);

  // Track cumulative working time across working+idle segments within a session
  const sessionBaseSecondsRef = useRef(0);

  // Refs that mirror state — used inside interval callbacks to avoid stale closures
  const displayStateRef = useRef(displayState);
  const currentEntryIdRef = useRef(currentEntryId);
  const entryStartTimeRef = useRef(entryStartTime);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { currentEntryIdRef.current = currentEntryId; }, [currentEntryId]);
  useEffect(() => { entryStartTimeRef.current = entryStartTime; }, [entryStartTime]);

  // Refs for interval cleanup
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTransitioningRef = useRef(false);
  const hasHydratedRef = useRef(false);

  const apiCall = useCallback(async (path: string, method: 'GET' | 'POST' = 'POST', body?: object) => {
    const idToken = await user?.getIdToken();
    if (!idToken) throw new Error('Not authenticated');

    const res = await fetch(`/api/time-tracking/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return res.json();
  }, [user]);

  // --- Hydrate from server on mount ---
  useEffect(() => {
    if (!user || hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    (async () => {
      try {
        const data = await apiCall('status', 'GET');
        setEnableScreenshots(data.enableScreenshots ?? false);

        // Resume from server state if:
        // 1. userClockOut is false (user did NOT intentionally stop / close the app)
        // 2. lastTime is fresh (< 2 min old) — rules out stale entries from crashes
        if (data.entry && !data.entry.userClockOut) {
          const lastTime = new Date(data.entry.lastTime).getTime();
          const isFresh = Date.now() - lastTime < STALE_THRESHOLD_MS;

          if (isFresh && (data.entry.state === 'working' || data.entry.state === 'on-break')) {
            const createdTime = new Date(data.entry.createdTime).getTime();
            setCurrentEntryId(data.entry.id);

            if (data.entry.state === 'working') {
              setEntryStartTime(createdTime);
              setDisplayState('working');
            } else if (data.entry.state === 'on-break') {
              setBreakStartTime(createdTime);
              setDisplayState('on-break');
            }
          }
        }
      } catch (err) {
        console.error('[TimeTracking] Status hydration failed:', err);
      }
    })();
  }, [user, apiCall]);

  // Reset hydration flag when user changes (logout/login)
  useEffect(() => {
    if (!user) {
      hasHydratedRef.current = false;
      setDisplayState('clocked-out');
      setCurrentEntryId(null);
      setEntryStartTime(null);
      setBreakStartTime(null);
      setElapsedSeconds(0);
      setBreakRemainingSeconds(null);
      setEnableScreenshots(false);
      sessionBaseSecondsRef.current = 0;
    }
  }, [user]);

  // --- App closing (Electron window close) → mark entry as userClockOut ---
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.onAppClosing) return;

    electronAPI.onAppClosing(async () => {
      const entryId = currentEntryIdRef.current;
      const state = displayStateRef.current;
      if (!entryId || state === 'clocked-out') return;

      try {
        const idToken = await user?.getIdToken();
        if (idToken) {
          await fetch('/api/time-tracking/clock-out', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
          });
        }
      } catch (err) {
        console.error('[TimeTracking] Clock-out on app close failed:', err);
      }
    });

    return () => {
      electronAPI.removeAppClosingListeners();
    };
  }, [user]);

  // --- Heartbeat ---
  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if ((displayState === 'working' || displayState === 'on-break') && currentEntryId) {
      heartbeatRef.current = setInterval(() => {
        const entryId = currentEntryIdRef.current;
        if (!entryId) return;
        apiCall('heartbeat', 'POST', { entryId }).catch((err) => {
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
  }, [displayState, currentEntryId, apiCall]);

  // --- Idle Detection ---
  useEffect(() => {
    if (idleCheckRef.current) {
      clearInterval(idleCheckRef.current);
      idleCheckRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking) return;

    if (displayState === 'working' && currentEntryId) {
      // Poll every 30s to detect when user goes idle
      idleCheckRef.current = setInterval(async () => {
        if (isTransitioningRef.current) return;
        if (displayStateRef.current !== 'working') return;

        try {
          const idleTime = await electronAPI.timeTracking.getIdleTime();
          if (idleTime >= IDLE_THRESHOLD_SECONDS) {
            isTransitioningRef.current = true;
            try {
              const entryId = currentEntryIdRef.current;
              if (!entryId) return;

              // Accumulate time from this working segment before going idle
              const startTime = entryStartTimeRef.current;
              if (startTime) {
                sessionBaseSecondsRef.current += Math.floor((Date.now() - startTime) / 1000);
              }

              const data = await apiCall('idle/start', 'POST', { currentEntryId: entryId });
              setCurrentEntryId(data.entryId);
              setEntryStartTime(Date.now());
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
    } else if (displayState === 'idle' && currentEntryId) {
      // Poll every 5s to detect when user resumes activity
      idleCheckRef.current = setInterval(async () => {
        if (isTransitioningRef.current) return;
        if (displayStateRef.current !== 'idle') return;

        try {
          const idleTime = await electronAPI.timeTracking.getIdleTime();
          if (idleTime < IDLE_THRESHOLD_SECONDS) {
            isTransitioningRef.current = true;
            try {
              const entryId = currentEntryIdRef.current;
              if (!entryId) return;

              const data = await apiCall('idle/end', 'POST', { currentEntryId: entryId });
              setCurrentEntryId(data.entryId);
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
      }, IDLE_RESUME_CHECK_INTERVAL_MS);
    }

    return () => {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
    };
  }, [displayState, currentEntryId, apiCall]);

  // --- Timer Tick (1s) ---
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    if (displayState === 'clocked-out') {
      setElapsedSeconds(0);
      setBreakRemainingSeconds(null);
      return;
    }

    if (displayState === 'on-break' && breakStartTime) {
      const tick = () => {
        const elapsed = Math.floor((Date.now() - breakStartTime) / 1000);
        const remaining = Math.max(0, BREAK_DURATION_SECONDS - elapsed);
        setBreakRemainingSeconds(remaining);

        if (remaining <= 0) {
          const entryId = currentEntryIdRef.current;
          if (entryId) {
            apiCall('break/end', 'POST', { currentEntryId: entryId, autoExpired: true }).catch((err) => {
              console.error('[TimeTracking] Break auto-end failed:', err);
            });
          }
          setDisplayState('clocked-out');
          setCurrentEntryId(null);
          setEntryStartTime(null);
          setBreakStartTime(null);
          sessionBaseSecondsRef.current = 0;
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
            setElapsedSeconds(sessionBaseSecondsRef.current + currentSegment);
          }
        } else {
          // While idle, freeze the elapsed display at the accumulated total
          setElapsedSeconds(sessionBaseSecondsRef.current);
        }
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

  // --- Screenshot Scheduling ---
  useEffect(() => {
    if (screenshotTimeoutRef.current) {
      clearTimeout(screenshotTimeoutRef.current);
      screenshotTimeoutRef.current = null;
    }

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI?.timeTracking?.captureScreenshot) return;
    if (!enableScreenshots) return;
    if (displayState !== 'working' && displayState !== 'idle') return;

    const scheduleNextCapture = () => {
      const delay = Math.floor(Math.random() * SCREENSHOT_WINDOW_MS);

      screenshotTimeoutRef.current = setTimeout(async () => {
        const currentState = displayStateRef.current;
        if (currentState !== 'working' && currentState !== 'idle') return;

        try {
          const result = await electronAPI.timeTracking.captureScreenshot();
          if (result.success && result.screens && result.screens.length > 0) {
            const idToken = await user?.getIdToken();
            if (idToken) {
              await fetch('/api/time-tracking/screenshots/upload', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ screens: result.screens }),
              });
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

  // --- Actions ---

  const startTracking = useCallback(async () => {
    if (isLoading || displayState !== 'clocked-out') return;
    setIsLoading(true);
    try {
      const data = await apiCall('start', 'POST');
      sessionBaseSecondsRef.current = 0;
      setCurrentEntryId(data.entryId);
      setEntryStartTime(Date.now());
      setDisplayState('working');
    } catch (err) {
      console.error('[TimeTracking] Start failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, apiCall]);

  const stopTracking = useCallback(async () => {
    if (isLoading || (displayState !== 'working' && displayState !== 'idle')) return;
    setIsLoading(true);
    try {
      if (currentEntryId) {
        await apiCall('stop', 'POST', { entryId: currentEntryId });
      }
      setDisplayState('clocked-out');
      setCurrentEntryId(null);
      setEntryStartTime(null);
      sessionBaseSecondsRef.current = 0;
    } catch (err) {
      console.error('[TimeTracking] Stop failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, currentEntryId, apiCall]);

  const startBreak = useCallback(async () => {
    if (isLoading || displayState !== 'working' || !currentEntryId) return;
    setIsLoading(true);
    try {
      const data = await apiCall('break/start', 'POST', { currentEntryId });
      setCurrentEntryId(data.entryId);
      setBreakStartTime(Date.now());
      setEntryStartTime(null);
      setDisplayState('on-break');
    } catch (err) {
      console.error('[TimeTracking] Break start failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, currentEntryId, apiCall]);

  const endBreak = useCallback(async () => {
    if (isLoading || displayState !== 'on-break' || !currentEntryId) return;
    setIsLoading(true);
    try {
      const data = await apiCall('break/end', 'POST', { currentEntryId });
      sessionBaseSecondsRef.current = 0;
      setBreakStartTime(null);
      setBreakRemainingSeconds(null);
      setCurrentEntryId(data.entryId);
      setEntryStartTime(Date.now());
      setDisplayState('working');
    } catch (err) {
      console.error('[TimeTracking] Break end failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, displayState, currentEntryId, apiCall]);

  return (
    <TimeTrackingContext.Provider
      value={{
        displayState,
        currentEntryId,
        elapsedSeconds,
        breakRemainingSeconds,
        startTracking,
        stopTracking,
        startBreak,
        endBreak,
        isLoading,
      }}
    >
      {children}
    </TimeTrackingContext.Provider>
  );
}
