'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import type { ShiftUser } from '@/hooks/useShifts';
import { invalidateShiftCalendarCache } from '@/hooks/useShiftCalendar';
import { invalidateLeaveRequestsCache } from '@/hooks/useLeaveRequests';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

// ─── Color palette (matches STATE_CONFIG in time-tracking page) ───────

import { getShiftColor, hexToRgb } from '@/lib/utils/avatar';
import { safeTimezone } from '@/lib/utils/timezone';
import { CreatorChipList } from '@/components/creators/CreatorChip';
import { splitShiftAccounts } from '@/lib/salary/shiftAccounts';

// ─── Format helpers ──────────────────────────────────────────────────

function formatLocalTime(ms: number, tz: string): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: safeTimezone(tz),
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

  // Accounts worked as overtime *inside* this shift: the agent keeps the sales
  // but the wage tier is counted without them (ca-salary.md §6) — unless the
  // whole assignment is overtime, in which case this is an overtime shift and
  // pays on all of it.
  const accounts = splitShiftAccounts(shift.creatorIds, shift.overtimeCreatorIds);
  const paidCount = accounts.paidIds.length;
  // Either door to an overtime shift: assigned from the coverage board, or
  // built by hand here with every account marked. They pay the same, so they
  // must not read differently on the grid.
  const showOvertimeLabel = (shift.isOvertime ?? false) || accounts.isFullyOvertime;

  const badge = shift.attendanceStatus ? BADGE_CONFIG[shift.attendanceStatus] : null;
  const leaveBadge = shift.leaveRequest ? LEAVE_BADGE_CONFIG[shift.leaveRequest.status] : null;

  const cardStyle: React.CSSProperties = isFuture
    ? {
        background:   `rgba(${rgb}, 0.12)`,
        border:       `1px solid rgba(${rgb}, 0.30)`,
        borderRadius: '10px',
      }
    : {
        background:   `rgba(${rgb}, 0.20)`,
        border:       `1px solid rgba(${rgb}, 0.45)`,
        borderRadius: '10px',
      };

  async function handleLeaveAction(action: 'approve' | 'deny') {
    if (!authUser || !shift.leaveRequest) return;
    setIsActioning(true);
    try {
      const idToken = await authUser.getIdToken();
      const res = await fetch(`/api/shifts/leave/${shift.leaveRequest.leaveId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      // Checked, and the server's own message shown. This used to be
      // fire-and-forget, which was survivable while approval could not fail on
      // anything an admin controls. It can now: approving leave an agent has no
      // balance for is refused with a 409 naming the fix, and a refusal this
      // surface swallowed would look exactly like a success — the shift simply
      // staying on the roster, which is also what a successful *denial* looks
      // like. `useAdminLeaveQueue` already does this; this is the second call
      // site, and the one that gets forgotten (ca-salary.md §6).
      if (!res.ok) {
        let message = `Could not ${action} this request (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        toast.error(message);
        return;
      }

      // Approving released this occurrence, which changes the *agent's* roster —
      // and their dashboard caches it under a key this grid otherwise never
      // touches. `onLeaveAction` only refreshes the admin week view, so without
      // this the shift stayed on their calendar while the accounts it released
      // showed up on the overtime board immediately (that board caches nothing).
      // Reaches this tab only; other renderers revalidate on focus.
      invalidateShiftCalendarCache(shift.userId);
      invalidateLeaveRequestsCache(shift.userId);
      onLeaveAction?.();
    } catch (err) {
      console.error('[ShiftCard] leave action failed', err);
      // A thrown request is a network failure, and an admin who saw nothing
      // happen would click again. The console alone was never the audience.
      toast.error(`Could not ${action} this request. Check your connection and try again.`);
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

      {/* Creator accounts. The roster's whole reason for carrying them: this is
          the number that sets the agent's hourly rate, so it belongs on the card
          an admin reads the week from — not only inside the edit modal.
          Overtime is marked because it pays differently (see caCoverageService).

          Two kinds of overtime land here and they look different on purpose:
          a whole overtime shift takes the "OT" prefix, while individual accounts
          worked as overtime *inside* a regular shift take an orange ring each —
          the rest of that shift is ordinary paid work and must not be labelled
          as though it were not. */}
      {(shift.creatorIds?.length ?? 0) > 0 && (
        <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
          {showOvertimeLabel && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                color: shift.paysWage === false ? 'var(--foreground-secondary)' : '#fb923c',
                alignSelf: 'center',
              }}
              title={
                shift.paysWage === false
                  ? 'Covering inside an existing shift — sales only, no extra hours'
                  : 'Overtime — paid hours plus the sales'
              }
            >
              OT
            </span>
          )}
          {/* The count that actually pays, when it differs from the count of
              faces. A ring says "this one is different"; only the number says
              which rate the shift is on, and that is the figure an admin is
              here to check. */}
          {!showOvertimeLabel && accounts.overtimeIds.length > 0 && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                color: '#fb923c',
                alignSelf: 'center',
              }}
              title={`${accounts.overtimeIds.length} account${accounts.overtimeIds.length === 1 ? '' : 's'} worked as overtime inside this shift — sales only, no extra pay. Paid on ${paidCount} account${paidCount === 1 ? '' : 's'}.`}
            >
              +{accounts.overtimeIds.length} OT
            </span>
          )}
          {/* Avatars only — a roster cell in a seven-day grid has no room for
              names, and the admin is scanning for "who is on Adam today". */}
          {/* The raw field, not the derived subset: `CreatorChipList` is
              memoised and only tests membership, so a freshly-filtered array
              every render would defeat the memo and buy nothing. */}
          <CreatorChipList
            creatorIds={shift.creatorIds!}
            overtimeIds={shift.overtimeCreatorIds}
            max={4}
            size="xs"
            avatarOnly
          />
        </div>
      )}

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
