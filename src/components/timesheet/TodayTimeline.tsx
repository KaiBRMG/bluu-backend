'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useUserData } from '@/hooks/useUserData';
import { getTodaySessions } from '@/lib/localBuffer';
import { parseBuffer } from '@/lib/parseBuffer';
import type { LocalSessionBuffer, SessionEvent } from '@/types/firestore';
import { RefreshCcw } from 'lucide-react';
import { Button } from "@/components/ui/button";

// ─── Segment types ────────────────────────────────────────────────────

type SegmentKind = 'working' | 'idle' | 'break' | 'pause';

const SEGMENT_COLORS: Record<SegmentKind, string> = {
  working: '#86C27E',
  idle:    '#E37836',
  break:   '#4B8FCC',
  pause:   '#8B5CF6',
};

const SEGMENT_LABELS: Record<SegmentKind, string> = {
  working: 'Working',
  idle:    'Idle',
  break:   'Break',
  pause:   'Paused',
};

interface TimelineSegment {
  kind: SegmentKind;
  startMs: number;
  endMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getDayBoundsUTC(dateStr: string, timezone: string): { start: number; end: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(noonUTC));
  const noonH = parseInt(parts.find(p => p.type === 'hour')!.value,   10);
  const noonM = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const offsetMs = ((noonH * 60 + noonM) - (12 * 60)) * 60 * 1000;
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  return { start: dayStartUTC, end: dayStartUTC + 24 * 60 * 60 * 1000 - 1 };
}

function todayInTZ(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatTimeInTZ(ms: number, timezone: string): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (totalSeconds === 0) return '—';
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatAgo(sinceMs: number): string {
  const totalSeconds = Math.floor(sinceMs / 1000);
  if (totalSeconds < 60) return 'just now';
  const m = Math.floor(totalSeconds / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m ago`;
  return `${h}h${String(m % 60).padStart(2, '0')}m ago`;
}

// ─── Buffer → segments ────────────────────────────────────────────────

function buildSegments(events: SessionEvent[], nowMs: number): TimelineSegment[] {
  const segments: TimelineSegment[] = [];

  let workingStart: number | null = null;
  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;

  const closeWorking = (end: number) => {
    if (workingStart !== null && end > workingStart) {
      segments.push({ kind: 'working', startMs: workingStart, endMs: end });
      workingStart = null;
    }
  };

  for (const ev of events) {
    const t = ev.timestamp;

    switch (ev.type) {
      case 'clock-in':
      case 'resume':
        closeWorking(t);
        if (idleStart !== null) { segments.push({ kind: 'idle', startMs: idleStart, endMs: t }); idleStart = null; }
        if (breakStart !== null) { segments.push({ kind: 'break', startMs: breakStart, endMs: t }); breakStart = null; }
        if (pauseStart !== null) { segments.push({ kind: 'pause', startMs: pauseStart, endMs: t }); pauseStart = null; }
        workingStart = t;
        break;

      case 'idle-start':
        closeWorking(t);
        idleStart = t;
        break;

      case 'idle-end':
        if (idleStart !== null) { segments.push({ kind: 'idle', startMs: idleStart, endMs: t }); idleStart = null; }
        workingStart = t;
        break;

      case 'break-start':
        closeWorking(t);
        breakStart = t;
        break;

      case 'break-end':
        if (breakStart !== null) { segments.push({ kind: 'break', startMs: breakStart, endMs: t }); breakStart = null; }
        workingStart = t;
        break;

      case 'pause':
        closeWorking(t);
        pauseStart = t;
        break;

      case 'clock-out':
        closeWorking(t);
        if (idleStart !== null) { segments.push({ kind: 'idle', startMs: idleStart, endMs: t }); idleStart = null; }
        if (breakStart !== null) { segments.push({ kind: 'break', startMs: breakStart, endMs: t }); breakStart = null; }
        if (pauseStart !== null) { segments.push({ kind: 'pause', startMs: pauseStart, endMs: t }); pauseStart = null; }
        break;
    }
  }

  // Close open segments against nowMs (live session)
  if (workingStart !== null) segments.push({ kind: 'working', startMs: workingStart, endMs: nowMs });
  if (idleStart !== null)    segments.push({ kind: 'idle',    startMs: idleStart,    endMs: nowMs });
  if (breakStart !== null)   segments.push({ kind: 'break',   startMs: breakStart,   endMs: nowMs });
  if (pauseStart !== null)   segments.push({ kind: 'pause',   startMs: pauseStart,   endMs: nowMs });

  return segments;
}

// ─── Component ────────────────────────────────────────────────────────

const HOUR_MARKERS = [0, 6, 12, 18, 24];

export default function TodayTimeline() {
  const { sessionId, displayState } = useTimeTracking();
  const { userData } = useUserData();
  const timezone = userData?.timezone || 'UTC';
  const includeIdleTime = userData?.includeIdleTime ?? false;

  const [buffers, setBuffers] = useState<LocalSessionBuffer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [lastRefreshed, setLastRefreshed] = useState(() => Date.now());
  const [hoveredKey, setHoveredKey] = useState<string | null>(null); // `${bufIdx}-${segIdx}`
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const loadBuffers = useCallback(async () => {
    const sessions = await getTodaySessions(timezone);
    setBuffers(sessions);
    setLastRefreshed(Date.now());
  }, [timezone]);

  // Reload when the session changes or a state transition appends new buffer events
  useEffect(() => {
    loadBuffers();
  }, [loadBuffers, sessionId, displayState]);

  // Keep `now` in sync for live open-segment rendering
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const todayStr = useMemo(() => todayInTZ(timezone), [timezone]);
  const { start: dayStart, end: dayEnd } = useMemo(
    () => getDayBoundsUTC(todayStr, timezone),
    [todayStr, timezone]
  );
  const dayDuration = dayEnd - dayStart + 1;

  // Build segments per buffer; active session uses live nowMs for open segments
  const allSessionSegments = useMemo(() => {
    return buffers.map(buf => {
      const isActive = buf.sessionId === sessionId;
      const closeMs = isActive
        ? now
        : (buf.events.find(e => e.type === 'clock-out')?.timestamp ?? now);
      return buildSegments(buf.events, closeMs);
    });
  }, [buffers, sessionId, now]);

  // Total worked seconds across all today's sessions
  const totalWorkedSeconds = useMemo(() => {
    return buffers.reduce((sum, buf) => {
      const isActive = buf.sessionId === sessionId;
      const closeMs = isActive
        ? now
        : (buf.events.find(e => e.type === 'clock-out')?.timestamp ?? now);
      const totals = parseBuffer(buf.events, closeMs);
      return sum + totals.workingSeconds + totals.breakSeconds + (includeIdleTime ? totals.idleSeconds : 0);
    }, 0);
  }, [buffers, sessionId, now, includeIdleTime]);

  const toPercent = (ms: number) =>
    Math.max(0, Math.min(100, ((ms - dayStart) / dayDuration) * 100));

  if (displayState === 'clocked-out' && buffers.length === 0) {
    return (
      <div
        className="rounded-lg p-6 text-center text-sm"
        style={{
          color: 'var(--foreground-muted)',
          background: 'var(--container-background)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        No active session today.
      </div>
    );
  }

  const todayLabel = new Date().toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  // For each segment, compute the tooltip time range by merging consecutive
  // same-kind segments whose boundary falls within the same minute.
  const tooltipRanges = useMemo(() => {
    return allSessionSegments.map(segments => {
      const starts = segments.map(s => s.startMs);
      const ends = segments.map(s => s.endMs);
      for (let i = segments.length - 1; i > 0; i--) {
        const prev = segments[i - 1];
        const curr = segments[i];
        if (
          prev.kind === curr.kind &&
          Math.floor(prev.endMs / 60000) === Math.floor(curr.startMs / 60000)
        ) {
          starts[i] = starts[i - 1];
          ends[i - 1] = ends[i];
        }
      }
      return { starts, ends };
    });
  }, [allSessionSegments]);

  const hoveredSeg = (() => {
    if (!hoveredKey) return null;
    const [bi, si] = hoveredKey.split('-').map(Number);
    const seg = allSessionSegments[bi]?.[si];
    if (!seg) return null;
    return {
      kind: seg.kind,
      startMs: tooltipRanges[bi]?.starts[si] ?? seg.startMs,
      endMs: tooltipRanges[bi]?.ends[si] ?? seg.endMs,
    };
  })();

  return (
    <div
      className="rounded-lg p-6"
      style={{
        background: 'var(--container-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {todayLabel}
          </h2>
          <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
            Total worked: {formatDuration(totalWorkedSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
            Last updated {formatAgo(now - lastRefreshed)}
          </span>
          <Button
            onClick={loadBuffers}
            variant="ghost"
            size="icon"
            title="Refresh timeline"
          >
            <RefreshCcw width={16} height={16} />
          </Button>
        </div>
      </div>

      {/* Hour markers */}
      <div className="flex items-center mb-2">
        <div className="flex-1 flex justify-between text-xs" style={{ color: 'var(--foreground-muted)' }}>
          {HOUR_MARKERS.map(h => (
            <span key={h}>{h === 24 ? '23:59' : `${String(h).padStart(2, '0')}:00`}</span>
          ))}
        </div>
        <div className="w-20 flex-shrink-0" />
      </div>

      {/* Timeline bars — one per session */}
      <div className="flex flex-col gap-1.5">
        {allSessionSegments.map((segments, bi) => {
          const buf = buffers[bi];
          const isActive = buf.sessionId === sessionId;
          const closeMs = isActive
            ? now
            : (buf.events.find(e => e.type === 'clock-out')?.timestamp ?? now);
          const totals = parseBuffer(buf.events, closeMs);
          const workedSeconds = totals.workingSeconds;
          const h = Math.floor(workedSeconds / 3600);
          const m = Math.floor((workedSeconds % 3600) / 60);
          const sessionTotal = workedSeconds === 0 ? '—' : h === 0 ? `${m}m` : `${h}h ${m}m`;

          return (
            <div key={buf.sessionId} className="flex items-center gap-3">
              <div
                className="flex-1 relative h-7 rounded-full overflow-hidden"
                style={{ background: 'var(--border-subtle)' }}
              >
                {segments.map((seg, si) => {
                  const left = toPercent(seg.startMs);
                  const width = Math.max(0, toPercent(seg.endMs) - left);
                  const key = `${bi}-${si}`;
                  return (
                    <div
                      key={key}
                      className="absolute top-0 bottom-0 transition-opacity"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: SEGMENT_COLORS[seg.kind],
                        minWidth: '2px',
                        opacity: hoveredKey === key ? 0.8 : 1,
                      }}
                      onMouseEnter={(e) => {
                        setHoveredKey(key);
                        setMousePos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredKey(null)}
                    />
                  );
                })}
              </div>
              <div
                className="w-20 flex-shrink-0 text-xs text-right font-medium"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                {sessionTotal}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredSeg && (
        <div
          className="fixed z-50 px-3 py-2 rounded-lg text-xs shadow-lg pointer-events-none"
          style={{
            left: mousePos.x + 12,
            top: mousePos.y - 40,
            background: 'var(--background)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--foreground)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: SEGMENT_COLORS[hoveredSeg.kind] }}
            />
            <span className="font-medium">{SEGMENT_LABELS[hoveredSeg.kind]}</span>
          </div>
          <div style={{ color: 'var(--foreground-secondary)' }}>
            {formatTimeInTZ(hoveredSeg.startMs, timezone)}
            {' — '}
            {formatTimeInTZ(hoveredSeg.endMs, timezone)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        className="flex items-center gap-4 mt-4 pt-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {(Object.keys(SEGMENT_COLORS) as SegmentKind[]).map(kind => (
          <div key={kind} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: SEGMENT_COLORS[kind] }} />
            <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {SEGMENT_LABELS[kind]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
