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
}

interface DayTimelineProps {
  date: string; // YYYY-MM-DD
  entries: TimesheetEntry[];
  timezone: string;
}

function getDayBoundsUTC(dateStr: string, timezone: string): { start: number; end: number } {
  // Compute the UTC millisecond for 00:00:00 and 23:59:59.999 of the given date in the user's timezone
  // Parse the date string as year/month/day
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create a date string that represents midnight in the target timezone
  // Use the Intl API to find the UTC offset at that point
  const midnightLocal = new Date(`${dateStr}T00:00:00`);

  // Get the timezone offset by formatting and parsing
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Use a known UTC time and see what it maps to in the timezone to compute offset
  // Instead, construct the start-of-day using a reliable method:
  // Create dates and check using timezone formatting
  const parts = formatter.formatToParts(midnightLocal);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';

  // We need to find the UTC timestamp where the given timezone reads as YYYY-MM-DD 00:00:00
  // Binary approach is complex; instead use a simpler method:
  // Create a date at noon UTC on that day, then adjust based on the timezone offset
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const noonFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const noonHourInTZ = parseInt(noonFormatter.format(new Date(noonUTC)), 10);
  // offset in hours: if noon UTC shows as 17 in timezone, offset is +5
  const offsetHours = noonHourInTZ - 12;
  const offsetMs = offsetHours * 60 * 60 * 1000;

  // Start of day in UTC = midnight in timezone = midnight local - offset
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  const dayEndUTC = dayStartUTC + 24 * 60 * 60 * 1000 - 1; // 23:59:59.999

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
      });
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
            {formatTimeInTZ(segments[hoveredIndex].startTime, timezone)} — {formatTimeInTZ(segments[hoveredIndex].endTime, timezone)}
          </div>
        </div>
      )}
    </div>
  );
}
