'use client';

import { useState, useMemo } from 'react';
import type { TimesheetEntry } from '@/hooks/useTimesheetData';

type SegmentState = TimesheetEntry['state'];

const STATE_COLORS: Record<SegmentState, string> = {
  working: '#86C27E',
  idle: '#E37836',
  'on-break': '#4B8FCC',
  paused: '#8B5CF6',
};

const STATE_LABELS: Record<SegmentState, string> = {
  working: 'Working',
  idle: 'Idle',
  'on-break': 'On Break',
  paused: 'Paused',
};

interface Segment {
  leftPct: number;
  widthPct: number;
  state: SegmentState;
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

import { getDayBoundsUTC } from '@/lib/utils/timezone';

function formatTimeInTZ(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
