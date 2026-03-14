'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUserShifts } from '@/hooks/useUserShifts';
import { useUserData } from '@/hooks/useUserData';
import { useLeaveRequests, type LeaveRequest } from '@/hooks/useLeaveRequests';
import { Button } from "@/components/ui/button";
import { RefreshCcw } from 'lucide-react';
import { Loader } from "@/components/ui/loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending:  '#F59E0B',
  approved: '#22c55e',
  denied:   '#ef4444',
};

const LEAVE_STATUS_LABELS: Record<string, string> = {
  pending:  'Leave Requested',
  approved: 'Leave Approved',
  denied:   'Leave Denied',
};

// ─── Shift card (user-facing) ─────────────────────────────────────────

interface UserShiftCardProps {
  shift: ExpandedShift;
  timezone: string;
  userId: string;
  hasPaidLeave: boolean;
  remainingUnpaidLeave: number;
  remainingPaidLeave: number;
  leaveRequest: LeaveRequest | null;
  onRequestLeave: (leaveType: 'paid' | 'unpaid') => Promise<void>;
  onCancelLeave: () => Promise<void>;
}

function UserShiftCard({
  shift,
  timezone,
  userId,
  hasPaidLeave,
  remainingUnpaidLeave,
  remainingPaidLeave,
  leaveRequest,
  onRequestLeave,
  onCancelLeave,
}: UserShiftCardProps) {
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

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [pendingLeaveType, setPendingLeaveType] = useState<'paid' | 'unpaid' | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [noBalanceDialogType, setNoBalanceDialogType] = useState<'paid' | 'unpaid' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const leaveStatusColor = leaveRequest ? LEAVE_STATUS_COLORS[leaveRequest.status] : null;
  const leaveStatusLabel = leaveRequest ? LEAVE_STATUS_LABELS[leaveRequest.status] : null;
  const leaveTypeLabel = leaveRequest ? (leaveRequest.leaveType === 'paid' ? 'Paid' : 'Unpaid') : null;

  return (
    <div style={{ ...cardStyle, padding: '10px 14px', position: 'relative', marginBottom: '8px' }}>
      {/* Top row: shift info (left) + leave action (right) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        {/* Left: time, duration, attendance badge, time worked */}
        <div style={{ minWidth: 0 }}>
          {/* Attendance badge — past/current only */}
          {(isPast || isCurrent) && badge && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: badge.color }} />
              <span style={{ fontSize: '11px', color: badge.color, fontWeight: 500 }}>{badge.label}</span>
            </div>
          )}

          {/* Times */}
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--foreground)' }}>
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

        {/* Right: leave controls — future shifts only */}
        {isFuture && (
          <div style={{ flexShrink: 0 }}>
            {leaveRequest ? (
              <Button
                size="sm"
                variant="destructive"
                style={{ fontSize: '12px', height: '30px', paddingLeft: '12px', paddingRight: '12px' }}
                onClick={() => setCancelDialogOpen(true)}
                disabled={isSubmitting}
              >
                Cancel Leave
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    style={{ fontSize: '12px', height: '30px', paddingLeft: '12px', paddingRight: '12px' }}
                    disabled={isSubmitting}
                  >
                    Take Leave
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dark">
                  <DropdownMenuItem
                    onSelect={() => {
                      if (remainingUnpaidLeave <= 0) {
                        setNoBalanceDialogType('unpaid');
                        return;
                      }
                      setPendingLeaveType('unpaid');
                      setLeaveDialogOpen(true);
                    }}
                  >
                    Unpaid Leave{remainingUnpaidLeave <= 0 ? ' (0 remaining)' : ''}
                  </DropdownMenuItem>
                  {hasPaidLeave && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (remainingPaidLeave <= 0) {
                          setNoBalanceDialogType('paid');
                          return;
                        }
                        setPendingLeaveType('paid');
                        setLeaveDialogOpen(true);
                      }}
                    >
                      Paid Leave{remainingPaidLeave <= 0 ? ' (0 remaining)' : ''}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* Leave status indicator — shown below when a leave request exists */}
      {isFuture && leaveRequest && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: leaveStatusColor ?? '#F59E0B', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: leaveStatusColor ?? '#F59E0B', fontWeight: 500 }}>
            {leaveTypeLabel} {leaveStatusLabel}
          </span>
        </div>
      )}

      {/* No balance dialog */}
      <AlertDialog open={noBalanceDialogType !== null} onOpenChange={(open) => { if (!open) setNoBalanceDialogType(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No {noBalanceDialogType} leave remaining</AlertDialogTitle>
            <AlertDialogDescription>
              You have no remaining {noBalanceDialogType} leave days. 
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm request leave */}
      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          if (!open) { setLeaveDialogOpen(false); setPendingLeaveType(null); }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request {pendingLeaveType} leave?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>This will submit a {pendingLeaveType} leave request for this shift. An admin will need to approve it.</p>
                <p style={{ marginTop: '8px' }}>
                  After this action, you will have{' '}
                  <strong>{pendingLeaveType === 'paid' ? remainingPaidLeave - 1 : remainingPaidLeave} day{(pendingLeaveType === 'paid' ? remainingPaidLeave - 1 : remainingPaidLeave) !== 1 ? 's' : ''} paid leave</strong>
                  {' '}and{' '}
                  <strong>{pendingLeaveType === 'unpaid' ? remainingUnpaidLeave - 1 : remainingUnpaidLeave} day{(pendingLeaveType === 'unpaid' ? remainingUnpaidLeave - 1 : remainingUnpaidLeave) !== 1 ? 's' : ''} unpaid leave</strong> remaining.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingLeaveType) return;
                setIsSubmitting(true);
                try {
                  await onRequestLeave(pendingLeaveType);
                } catch {
                  // request failed — dialog closes regardless
                } finally {
                  setIsSubmitting(false);
                  setLeaveDialogOpen(false);
                  setPendingLeaveType(null);
                }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm cancel leave */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will withdraw your leave request for this shift.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              style={{ background: '#ef4444' }}
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  await onCancelLeave();
                } catch {
                  // cancel failed — dialog closes regardless
                } finally {
                  setIsSubmitting(false);
                  setCancelDialogOpen(false);
                }
              }}
            >
              Cancel Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

  const { shifts, loading, error, refetch: refetchShifts } = useUserShifts();
  const { getLeaveForShift, requestLeave, cancelLeave, refetch: refetchLeave } = useLeaveRequests();

  // Refresh leave request status each time the user navigates to this view,
  // so approvals/denials from admins are reflected immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refetchLeave(); }, []);

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

  const hasPaidLeave = userData?.hasPaidLeave ?? false;
  const remainingUnpaidLeave = userData?.remainingUnpaidLeave ?? 0;
  const remainingPaidLeave = userData?.remainingPaidLeave ?? 0;

  return (
    <div>
      {/* Leave balance summary */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <div style={{
          flex: 1,
          padding: '12px 16px',
          background: 'var(--container-background)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
        }}>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
            Unpaid Leave
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: remainingUnpaidLeave > 0 ? 'var(--foreground)' : '#ef4444', lineHeight: 1 }}>
            {remainingUnpaidLeave}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>days remaining</div>
        </div>
        {hasPaidLeave && (
          <div style={{
            flex: 1,
            padding: '12px 16px',
            background: 'var(--container-background)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
          }}>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Paid Leave
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: remainingPaidLeave > 0 ? 'var(--foreground)' : '#ef4444', lineHeight: 1 }}>
              {remainingPaidLeave}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>days remaining</div>
          </div>
        )}
      </div>

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
        <Button
          onClick={() => { refetchShifts(); refetchLeave(); }}
          variant="ghost"
          size="icon"
          title="Refresh shifts"
        >
          <RefreshCcw width={16} height={16} />
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
          {(byDate.get(dateStr) ?? []).map(shift => {
            const leaveRequest = getLeaveForShift(shift.shiftId, shift.occurrenceStart);
            return (
              <UserShiftCard
                key={shift.shiftId + shift.occurrenceStart}
                shift={shift}
                timezone={tz}
                userId={uid}
                hasPaidLeave={hasPaidLeave}
                remainingUnpaidLeave={remainingUnpaidLeave}
                remainingPaidLeave={remainingPaidLeave}
                leaveRequest={leaveRequest}
                onRequestLeave={(leaveType) => requestLeave(shift.shiftId, shift.occurrenceStart, leaveType)}
                onCancelLeave={() => {
                  if (leaveRequest) return cancelLeave(leaveRequest.leaveId);
                  return Promise.resolve();
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
