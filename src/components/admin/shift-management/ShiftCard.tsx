'use client';

import { useState } from 'react';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import type { ShiftUser } from '@/hooks/useShifts';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

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

// ─── Leave badge ─────────────────────────────────────────────────────

const LEAVE_BADGE_CONFIG = {
  pending:  { color: '#F59E0B', label: 'Leave Requested' },
  approved: { color: '#22c55e', label: 'Leave Approved'  },
  denied:   { color: '#ef4444', label: 'Leave Denied'    },
} as const;

// ─── Component ───────────────────────────────────────────────────────

interface ShiftCardProps {
  shift: ExpandedShift;
  user: ShiftUser;
  viewerTimezone: string;  // admin's timezone — times are displayed in this tz
  onClick?: () => void;
  onLeaveAction?: () => void;
}

export default function ShiftCard({ shift, user, viewerTimezone, onClick, onLeaveAction }: ShiftCardProps) {
  const { user: authUser } = useAuth();
  const [isActioning, setIsActioning] = useState(false);

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
  const leaveBadge = shift.leaveRequest ? LEAVE_BADGE_CONFIG[shift.leaveRequest.status] : null;

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

  async function handleLeaveAction(action: 'approve' | 'deny') {
    if (!authUser || !shift.leaveRequest) return;
    setIsActioning(true);
    try {
      const idToken = await authUser.getIdToken();
      await fetch(`/api/shifts/leave/${shift.leaveRequest.leaveId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      onLeaveAction?.();
    } catch (err) {
      console.error('[ShiftCard] leave action failed', err);
    } finally {
      setIsActioning(false);
    }
  }

  const cardContent = (
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
      {/* Leave badge — shown above attendance badge */}
      {leaveBadge && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '2px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: leaveBadge.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '10px', color: leaveBadge.color, fontWeight: 500 }}>
            {leaveBadge.label}
          </span>
        </div>
      )}

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
    </div>
  );

  // Wrap in HoverCard only when there's a leave request
  if (!shift.leaveRequest) {
    return cardContent;
  }

  const { status, leaveType } = shift.leaveRequest;
  const leaveTypeLabel = leaveType === 'paid' ? 'Paid leave' : 'Unpaid leave';

  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        {cardContent}
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" style={{ width: '210px', padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '2px' }}>
          {status === 'pending' && 'Approve user-requested leave'}
          {status === 'approved' && 'Leave Approved'}
          {status === 'denied' && 'Leave Denied'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          {leaveTypeLabel}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(status === 'pending' || status === 'denied') && (
            <Button
              size="sm"
              disabled={isActioning}
              style={{ fontSize: '11px', height: 'auto', padding: '3px 10px', background: '#22c55e', color: '#fff', border: 'none' }}
              onClick={(e) => { e.stopPropagation(); handleLeaveAction('approve'); }}
            >
              Approve
            </Button>
          )}
          {(status === 'pending' || status === 'approved') && (
            <Button
              size="sm"
              disabled={isActioning}
              style={{ fontSize: '11px', height: 'auto', padding: '3px 10px', background: '#ef4444', color: '#fff', border: 'none' }}
              onClick={(e) => { e.stopPropagation(); handleLeaveAction('deny'); }}
            >
              Deny
            </Button>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
