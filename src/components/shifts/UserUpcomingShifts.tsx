'use client';

import { useState, useMemo } from 'react';
import { useUserShifts } from '@/hooks/useUserShifts';
import { useUserData } from '@/hooks/useUserData';
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import type { ExpandedShift } from '@/lib/utils/recurrence';

// ─── Helpers ─────────────────────────────────────────────────────────

const SHIFT_COLORS = ['#4B8FCC', '#86C27E', '#E37836', '#8B5CF6'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getShiftColor(userId: string): string {
  return SHIFT_COLORS[hashString(userId) % SHIFT_COLORS.length];
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

function formatLocalTime(ms: number, tz: string): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatWorked(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatDateHeader(ms: number, tz: string): string {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function toLocalDateStr(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(dt.getTime() - mondayOffset * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const BADGE_CONFIG = {
  'on-time': { color: '#86C27E', label: 'On Time' },
  'late':    { color: '#E37836', label: 'Late'    },
  'absent':  { color: '#DF626E', label: 'Absent'  },
} as const;

// ─── Shift card (user-facing, no click) ──────────────────────────────

function UserShiftCard({ shift, timezone, userId }: { shift: ExpandedShift; timezone: string; userId: string }) {
  const now       = Date.now();
  const startMs   = shift.occurrenceStart;
  const endMs     = shift.occurrenceEnd;
  const isPast    = endMs <= now;
  const isCurrent = startMs <= now && endMs > now;
  const isFuture  = startMs > now;

  const color = getShiftColor(userId);
  const rgb   = hexToRgb(color);

  const badge = shift.attendanceStatus ? BADGE_CONFIG[shift.attendanceStatus] : null;

  const cardStyle: React.CSSProperties = isFuture
    ? { background: `rgba(${rgb}, 0.12)`, borderLeft: `3px solid ${color}`, borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }
    : { background: `rgba(${rgb}, 0.20)`, border: `1px solid rgba(${rgb}, 0.45)`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };

  return (
    <div style={{ ...cardStyle, padding: '10px 14px', position: 'relative', marginBottom: '8px' }}>
      {/* Attendance badge */}
      {(isPast || isCurrent) && badge && (
        <div style={{ position: 'absolute', top: '10px', right: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: badge.color }} />
          <span style={{ fontSize: '11px', color: badge.color, fontWeight: 500 }}>{badge.label}</span>
        </div>
      )}

      {/* Times */}
      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--foreground)', paddingRight: badge ? '80px' : '0' }}>
        {formatLocalTime(startMs, timezone)} – {formatLocalTime(endMs, timezone)}
      </div>

      {/* Duration */}
      <div style={{ fontSize: '12px', color: 'var(--foreground-secondary)', marginTop: '2px' }}>
        {Math.round((endMs - startMs) / 3_600_000 * 10) / 10}h shift
        {shift.isRecurring && ' · Recurring'}
      </div>

      {/* Time worked */}
      {isPast && shift.timeWorkedSeconds !== null && (
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
          Time worked: {formatWorked(shift.timeWorkedSeconds)}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────

export default function UserUpcomingShifts() {
  const { userData } = useUserData();
  const tz = userData?.timezone ?? 'UTC';
  const uid = userData?.uid ?? '';

  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(today));

  const { shifts, loading, error } = useUserShifts();

  // Filter to the displayed week
  const [wy, wm, wd] = weekStart.split('-').map(Number);
  const windowStartMs = Date.UTC(wy, wm - 1, wd, 0, 0, 0, 0);
  const windowEndMs   = Date.UTC(wy, wm - 1, wd + 6, 23, 59, 59, 999);

  const weekShifts = useMemo(() =>
    shifts.filter(s => s.occurrenceEnd > windowStartMs && s.occurrenceStart < windowEndMs),
    [shifts, windowStartMs, windowEndMs],
  );

  // Group by local date
  const byDate = useMemo(() => {
    const map = new Map<string, ExpandedShift[]>();
    for (const s of weekShifts) {
      const dateKey = toLocalDateStr(s.occurrenceStart, tz);
      const arr = map.get(dateKey) ?? [];
      arr.push(s);
      map.set(dateKey, arr);
    }
    return map;
  }, [weekShifts, tz]);

  const sortedDates = [...byDate.keys()].sort();

  const currentWeek = getMondayOfWeek(today);
  const isCurrentWeek = weekStart <= currentWeek;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Button
          onClick={() => !isCurrentWeek && setWeekStart(addDays(weekStart, -7))}
          disabled={isCurrentWeek}
          variant="outline"
          size="sm"
        >
          ←
        </Button>
        <Button
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          variant="outline"
          size="sm"
        >
          →
        </Button>
        <Button
          onClick={() => !isCurrentWeek && setWeekStart(currentWeek)}
          disabled={isCurrentWeek}
          variant="outline"
          size="sm"
          style={{ color: 'var(--foreground-secondary)', fontSize: '12px' }}
        >
          This Week
        </Button>
      </div>

      {loading && (
        <div style={{ padding: '32px', display: 'flex', justifyContent: 'center' }}>
          <Loader />
        </div>
      )}

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {!loading && weekShifts.length === 0 && (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: 'var(--foreground-muted)',
            fontSize: '13px',
            background: 'var(--container-background)',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          No shifts scheduled for this week.
        </div>
      )}

      {sortedDates.map(dateStr => (
        <div key={dateStr} style={{ marginBottom: '20px' }}>
          <h3 style={{
            fontSize: '13px',
            fontWeight: 600,
            color: dateStr === today ? 'var(--foreground)' : 'var(--foreground-secondary)',
            marginBottom: '8px',
            paddingBottom: '6px',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            {dateStr === today ? 'Today — ' : ''}{formatDateHeader(byDate.get(dateStr)![0].occurrenceStart, tz)}
          </h3>
          {(byDate.get(dateStr) ?? []).map(shift => (
            <UserShiftCard
              key={shift.shiftId + shift.occurrenceStart}
              shift={shift}
              timezone={tz}
              userId={uid}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
