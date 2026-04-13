'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUserShifts } from '@/hooks/useUserShifts';
import { useUserData } from '@/hooks/useUserData';
import { useLeaveRequests, type LeaveRequest } from '@/hooks/useLeaveRequests';
import { Button } from "@/components/ui/button";
import { RefreshCcw, ChevronLeft, ChevronRight } from 'lucide-react';
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

import { getShiftColor, hexToRgb } from '@/lib/utils/avatar';

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

import { toLocalDateStr, getMondayOfWeek, addCalendarDays as addDays } from '@/lib/utils/timezone';

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
    <div style={cardStyle} className="px-3.5 py-2.5 relative mb-2">
      {/* Top row: shift info (left) + leave action (right) */}
      <div className="flex items-start justify-between gap-3">
        {/* Left: time, duration, attendance badge, time worked */}
        <div className="min-w-0">
          {/* Attendance badge — past/current only */}
          {(isPast || isCurrent) && badge && (
            <div className="flex items-center gap-1 mb-0.5">
              <div className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: badge.color }} />
              <span className="text-[11px] font-medium" style={{ color: badge.color }}>{badge.label}</span>
            </div>
          )}

          {/* Times */}
          <div className="font-semibold text-sm text-foreground">
            {formatLocalTime(startMs, timezone)} – {formatLocalTime(endMs, timezone)}
          </div>

          {/* Duration */}
          <div className="text-xs text-foreground-secondary mt-0.5">
            {Math.round((endMs - startMs) / 3_600_000 * 10) / 10}h shift
            {shift.isRecurring && ' · Recurring'}
          </div>

          {/* Time worked */}
          {isPast && shift.timeWorkedSeconds !== null && (
            <div className="text-xs text-foreground-muted mt-1">
              Time worked: {formatWorked(shift.timeWorkedSeconds)}
            </div>
          )}
        </div>

        {/* Right: leave controls — future shifts only */}
        {isFuture && (
          <div className="flex-shrink-0">
            {leaveRequest ? (
              <Button
                size="sm"
                variant="destructive"
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
        <div className="flex items-center gap-[5px] mt-2">
          <div className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: leaveStatusColor ?? '#F59E0B' }} />
          <span className="text-[11px] font-medium" style={{ color: leaveStatusColor ?? '#F59E0B' }}>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
      <div className="flex gap-2.5 mb-5">
        <div className="flex-1 p-3 px-4 bg-container-bg border border-border-subtle rounded-[10px]">
          <div className="text-[11px] text-foreground-muted font-medium uppercase tracking-[0.05em] mb-1">
            Unpaid Leave
          </div>
          <div
            className="text-[22px] font-bold leading-none"
            style={{ color: remainingUnpaidLeave > 0 ? 'var(--foreground)' : '#ef4444' }}
          >
            {remainingUnpaidLeave}
          </div>
          <div className="text-[11px] text-foreground-muted mt-0.5">days remaining</div>
        </div>
        {hasPaidLeave && (
          <div className="flex-1 p-3 px-4 bg-container-bg border border-border-subtle rounded-[10px]">
            <div className="text-[11px] text-foreground-muted font-medium uppercase tracking-[0.05em] mb-1">
              Paid Leave
            </div>
            <div
              className="text-[22px] font-bold leading-none"
              style={{ color: remainingPaidLeave > 0 ? 'var(--foreground)' : '#ef4444' }}
            >
              {remainingPaidLeave}
            </div>
            <div className="text-[11px] text-foreground-muted mt-0.5">days remaining</div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          onClick={() => !isCurrentWeek && setWeekStart(addDays(weekStart, -7))}
          disabled={isCurrentWeek}
          variant="outline"
          size="sm"
        >
          <ChevronLeft width={16} height={16} />
        </Button>
        <Button
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          variant="outline"
          size="sm"
        >
          <ChevronRight width={16} height={16} />
        </Button>
        <Button
          onClick={() => !isCurrentWeek && setWeekStart(currentWeek)}
          disabled={isCurrentWeek}
          variant="outline"
          size="sm"
          className="text-foreground-secondary text-xs"
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
        <div className="flex justify-center p-8">
          <Loader />
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-[13px] mb-3 text-[#ef4444] bg-[rgba(239,68,68,0.1)]">
          {error}
        </div>
      )}

      {!loading && weekShifts.length === 0 && (
        <div className="p-8 text-center text-foreground-muted text-[13px] bg-container-bg rounded-lg border border-border-subtle">
          No shifts scheduled for this week.
        </div>
      )}

      {sortedDates.map(dateStr => (
        <div key={dateStr} className="mb-5">
          <h3
            className="text-[13px] font-semibold mb-2 pb-1.5 border-b border-border-subtle"
            style={{ color: dateStr === today ? 'var(--foreground)' : 'var(--foreground-secondary)' }}
          >
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
