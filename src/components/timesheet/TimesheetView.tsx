'use client';

import { useMemo } from 'react';
import DayTimeline from './DayTimeline';
import type { TimesheetEntry } from '@/hooks/useTimesheetData';

interface TimesheetViewProps {
  entries: TimesheetEntry[];
  timezone: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  loading: boolean;
  includeIdleTime: boolean;
}

function getDayBoundsUTC(dateStr: string, timezone: string): { start: number; end: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const noonFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const noonHourInTZ = parseInt(noonFormatter.format(new Date(noonUTC)), 10);
  const offsetHours = noonHourInTZ - 12;
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  const dayEndUTC = dayStartUTC + 24 * 60 * 60 * 1000 - 1;
  return { start: dayStartUTC, end: dayEndUTC };
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const current = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (current <= end) {
    dates.push(toLocalDateString(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function computeDailyTotal(
  entries: TimesheetEntry[],
  dayStart: number,
  dayEnd: number,
  includeIdleTime: boolean,
): string {
  let totalMs = 0;
  for (const entry of entries) {
    if (entry.state === 'idle' && !includeIdleTime) continue;

    const entryStart = new Date(entry.createdTime).getTime();
    const entryEnd = new Date(entry.lastTime).getTime();
    const clampedStart = Math.max(entryStart, dayStart);
    const clampedEnd = Math.min(entryEnd, dayEnd);

    if (clampedStart < clampedEnd) {
      totalMs += clampedEnd - clampedStart;
    }
  }

  const totalMinutes = Math.floor(totalMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0 && minutes === 0) return '—';
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function TimesheetView({
  entries,
  timezone,
  startDate,
  endDate,
  loading,
  includeIdleTime,
}: TimesheetViewProps) {
  const dates = useMemo(() => generateDates(startDate, endDate), [startDate, endDate]);

  // Group entries by date (an entry can appear in multiple days if it spans midnight)
  const entriesByDate = useMemo(() => {
    const map: Record<string, TimesheetEntry[]> = {};
    for (const date of dates) {
      const { start, end } = getDayBoundsUTC(date, timezone);
      const dayEntries: TimesheetEntry[] = [];
      for (const entry of entries) {
        const entryStart = new Date(entry.createdTime).getTime();
        const entryEnd = new Date(entry.lastTime).getTime();
        // Entry overlaps with this day if it starts before dayEnd and ends after dayStart
        if (entryStart <= end && entryEnd >= start) {
          dayEntries.push(entry);
        }
      }
      map[date] = dayEntries;
    }
    return map;
  }, [dates, entries, timezone]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading timesheet...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Hour markers header */}
      <div className="flex items-center mb-2">
        <div className="w-28 flex-shrink-0" />
        <div className="flex-1 relative">
          <div className="flex justify-between text-xs" style={{ color: 'var(--foreground-muted)' }}>
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:59</span>
          </div>
        </div>
        <div className="w-20 flex-shrink-0" />
      </div>

      {/* Day rows - most recent at top */}
      <div className="space-y-2">
        {[...dates].reverse().map((date) => {
          const dayEntries = entriesByDate[date] || [];
          const { start, end } = getDayBoundsUTC(date, timezone);
          const total = computeDailyTotal(dayEntries, start, end, includeIdleTime);

          return (
            <div key={date} className="flex items-center gap-3">
              <div
                className="w-28 flex-shrink-0 text-xs text-right"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                {formatDateLabel(date)}
              </div>
              <div className="flex-1">
                <DayTimeline date={date} entries={dayEntries} timezone={timezone} />
              </div>
              <div
                className="w-20 flex-shrink-0 text-xs text-right font-medium"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                {total}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {[
          { color: '#22c55e', label: 'Working' },
          { color: '#f59e0b', label: 'Idle' },
          { color: '#8b5cf6', label: 'On Break' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
            <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
