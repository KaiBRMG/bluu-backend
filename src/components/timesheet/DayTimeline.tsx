'use client';

import { useState, useMemo } from 'react';
import type { TimesheetEntry } from '@/hooks/useTimesheetData';
import type { TimeEntryState } from '@/types/firestore';

const STATE_COLORS: Record<TimeEntryState, string> = {
  working: '#86C27E',
  idle: '#E37836',
  'on-break': '#4B8FCC',
};

const STATE_LABELS: Record<TimeEntryState, string> = {
  working: 'Working',
  idle: 'Idle',
  'on-break': 'On Break',
};

interface Segment {
  leftPct: number;
  widthPct: number;
  state: TimeEntryState;
  startTime: Date;
  endTime: Date;
  // For tooltip: may span multiple merged entries
  tooltipStartTime: Date;
  tooltipEndTime: Date;
}

interface DayTimelineProps {
  date: string; // YYYY-MM-DD
  entries: TimesheetEntry[];
  timezone: string;
}

/**
 * Returns UTC millisecond bounds for a calendar date (YYYY-MM-DD) as observed
 * in `timezone`. Handles sub-hour offsets (India +5:30, Nepal +5:45, etc.) and
 * DST correctly by sampling the actual timezone offset at noon on that day.
 *
 * Strategy: format noon-UTC as H and M in the target timezone, compute the
 * exact offset in minutes (including sub-hour), then derive day-start UTC.
 * Noon is used because it is far from both midnight boundaries, so a single
 * DST transition within the day does not affect the noon offset we read.
 */
function getDayBoundsUTC(dateStr: string, timezone: string): { start: number; end: number } {
  const [year, month, day] = dateStr.split('-').map(Number);

  // Sample the offset at noon UTC → what H:M does the timezone show?
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(noonUTC));
  const noonHourInTZ   = parseInt(parts.find(p => p.type === 'hour')!.value,   10);
  const noonMinuteInTZ = parseInt(parts.find(p => p.type === 'minute')!.value, 10);

  // offset = local noon − UTC noon, in minutes (positive = east of UTC)
  const offsetMinutes = (noonHourInTZ * 60 + noonMinuteInTZ) - (12 * 60);
  const offsetMs = offsetMinutes * 60 * 1000;

  // UTC timestamp of midnight in the target timezone for that calendar date
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  const dayEndUTC   = dayStartUTC + 24 * 60 * 60 * 1000 - 1; // 23:59:59.999

  return { start: dayStartUTC, end: dayEndUTC };
}

function formatTimeInTZ(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function DayTimeline({ date, entries, timezone }: DayTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const { segments, dayStart, dayDuration } = useMemo(() => {
    const { start, end } = getDayBoundsUTC(date, timezone);
    const duration = end - start + 1;
    const segs: Segment[] = [];

    for (const entry of entries) {
      const entryStart = new Date(entry.createdTime).getTime();
      const entryEnd = new Date(entry.lastTime).getTime();

      // Clamp to day boundaries
      const clampedStart = Math.max(entryStart, start);
      const clampedEnd = Math.min(entryEnd, end);

      if (clampedStart >= clampedEnd) continue;

      const leftPct = ((clampedStart - start) / duration) * 100;
      const widthPct = ((clampedEnd - clampedStart) / duration) * 100;

      segs.push({
        leftPct,
        widthPct,
        state: entry.state,
        startTime: new Date(clampedStart),
        endTime: new Date(clampedEnd),
        tooltipStartTime: new Date(clampedStart),
        tooltipEndTime: new Date(clampedEnd),
      });
    }

    // Merge consecutive segments of the same state where the boundary falls within the same minute
    for (let i = segs.length - 1; i > 0; i--) {
      const prev = segs[i - 1];
      const curr = segs[i];
      if (
        prev.state === curr.state &&
        Math.floor(prev.endTime.getTime() / 60000) === Math.floor(curr.startTime.getTime() / 60000)
      ) {
        prev.tooltipEndTime = curr.tooltipEndTime;
        curr.tooltipStartTime = prev.tooltipStartTime;
      }
    }

    return { segments: segs, dayStart: start, dayDuration: duration };
  }, [date, entries, timezone]);

  return (
    <div
      className="relative w-full h-7 rounded-full overflow-hidden"
      style={{ background: 'var(--border-subtle)' }}
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 transition-opacity"
          style={{
            left: `${seg.leftPct}%`,
            width: `${seg.widthPct}%`,
            background: STATE_COLORS[seg.state],
            opacity: hoveredIndex === i ? 0.85 : 1,
            minWidth: '2px',
          }}
          onMouseEnter={(e) => {
            setHoveredIndex(i);
            setMousePos({ x: e.clientX, y: e.clientY });
          }}
          onMouseMove={(e) => {
            setMousePos({ x: e.clientX, y: e.clientY });
          }}
          onMouseLeave={() => setHoveredIndex(null)}
        />
      ))}

      {/* Tooltip */}
      {hoveredIndex !== null && segments[hoveredIndex] && (
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
              style={{ background: STATE_COLORS[segments[hoveredIndex].state] }}
            />
            <span className="font-medium">{STATE_LABELS[segments[hoveredIndex].state]}</span>
          </div>
          <div style={{ color: 'var(--foreground-secondary)' }}>
            {formatTimeInTZ(segments[hoveredIndex].tooltipStartTime, timezone)} — {formatTimeInTZ(segments[hoveredIndex].tooltipEndTime, timezone)}
          </div>
        </div>
      )}
    </div>
  );
}
