'use client';

import type { ExpandedShift } from '@/lib/utils/recurrence';
import type { ShiftUser } from '@/hooks/useShifts';

// ─── Color palette (matches STATE_CONFIG in time-tracking page) ───────

const SHIFT_COLORS = ['#4B8FCC', '#86C27E', '#E37836', '#8B5CF6'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
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

// ─── Format helpers ──────────────────────────────────────────────────

function formatLocalTime(ms: number, tz: string): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatWorked(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

// ─── Attendance badge ────────────────────────────────────────────────

const BADGE_CONFIG = {
  'on-time': { color: '#86C27E', label: 'On Time' },
  'late':    { color: '#E37836', label: 'Late'    },
  'absent':  { color: '#DF626E', label: 'Absent'  },
} as const;

// ─── Component ───────────────────────────────────────────────────────

interface ShiftCardProps {
  shift: ExpandedShift;
  user: ShiftUser;
  viewerTimezone: string;  // admin's timezone — times are displayed in this tz
  onClick?: () => void;
}

export default function ShiftCard({ shift, user, viewerTimezone, onClick }: ShiftCardProps) {
  const now          = Date.now();
  const startMs      = shift.occurrenceStart;
  const endMs        = shift.occurrenceEnd;
  const isPast       = endMs <= now;
  const isCurrent    = startMs <= now && endMs > now;
  const isFuture     = startMs > now;

  const color    = getShiftColor(user.uid);
  const rgb      = hexToRgb(color);

  const startLabel = formatLocalTime(startMs, viewerTimezone);
  const endLabel   = formatLocalTime(endMs,   viewerTimezone);

  const badge = shift.attendanceStatus ? BADGE_CONFIG[shift.attendanceStatus] : null;

  const cardStyle: React.CSSProperties = isFuture
    ? {
        background:   `rgba(${rgb}, 0.12)`,
        borderLeft:   `3px solid ${color}`,
        borderRadius: '10px',
        boxShadow:    '0 1px 4px rgba(0,0,0,0.12)',
      }
    : {
        background:   `rgba(${rgb}, 0.20)`,
        border:       `1px solid rgba(${rgb}, 0.45)`,
        borderRadius: '10px',
        boxShadow:    '0 1px 3px rgba(0,0,0,0.10)',
      };

  return (
    <div
      onClick={onClick}
      style={{
        ...cardStyle,
        position: 'relative',
        padding: '6px 8px',
        cursor: onClick ? 'pointer' : 'default',
        marginBottom: '4px',
        fontSize: '12px',
        userSelect: 'none',
      }}
    >
      {/* Attendance badge — inline flow, only for past/current */}
      {(isPast || isCurrent) && badge && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '2px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: badge.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '10px', color: badge.color, fontWeight: 500 }}>
            {badge.label}
          </span>
        </div>
      )}

      {/* Time range */}
      <div style={{ fontWeight: 400, fontSize: '10px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {startLabel} – {endLabel}
      </div>

      {/* Time worked — past shifts only */}
      {isPast && shift.timeWorkedSeconds !== null && (
        <div style={{ marginTop: '2px', color: 'var(--foreground-secondary)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Worked: {formatWorked(shift.timeWorkedSeconds)}
        </div>
      )}

      {/* Recurring indicator */}
      {shift.isRecurring && (
        <div style={{ marginTop: '2px', color: 'var(--foreground-muted)', fontSize: '10px' }}>
          Recurring
        </div>
      )}
    </div>
  );
}
