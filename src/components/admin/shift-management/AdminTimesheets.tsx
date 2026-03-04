'use client';

import { useState, useMemo } from 'react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useTimesheetData } from '@/hooks/useTimesheetData';
import { useUserData } from '@/hooks/useUserData';
import TimesheetView from '@/components/timesheet/TimesheetView';
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

interface AdminTimesheetsProps {
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

export default function AdminTimesheets({ selectedUserId, onUserChange }: AdminTimesheetsProps) {
  const { users, loading: usersLoading } = useAdminUsers();
  const { userData: viewerData } = useUserData();
  const viewerTimezone = viewerData?.timezone || 'UTC';
  const today = toDateString(new Date());
  const [startDate, setStartDate] = useState(addDays(today, -6));
  const [endDate, setEndDate] = useState(today);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const timeTrackedUsers = useMemo(() => users, [users]);

  // Validate date range
  const dateError = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    if (end < start) return 'End date must be after start date';
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31) {
      const earliestStart = addDays(endDate, -31);
      const latestEnd = addDays(startDate, 31);
      const fmtStart = new Date(earliestStart + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
      const fmtEnd = new Date(latestEnd + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
      return `Maximum range is 31 days. Select ${fmtStart} as the start date or ${fmtEnd} as the end date.`;
    }
    return null;
  }, [startDate, endDate]);

  const { entries, timezone, includeIdleTime, loading: entriesLoading, error } = useTimesheetData(
    selectedUserId,
    dateError ? null : startDate,
    dateError ? null : endDate,
    viewerTimezone,
  );

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight mb-4">
        Timesheets
      </h2>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="form-label block mb-1">Employee</label>
          <select
            className="form-input"
            value={selectedUserId || ''}
            onChange={(e) => onUserChange(e.target.value || null)}
            disabled={usersLoading}
          >
            <option value="">Select a user...</option>
            {timeTrackedUsers.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName || `${u.firstName} ${u.lastName}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label block mb-1">Start Date</label>
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="form-input flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                {startDate}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate ? new Date(startDate + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                disabled={{ after: new Date(today + 'T00:00:00') }}
                onSelect={(date: Date | undefined) => {
                  if (date) setStartDate(date.toLocaleDateString('en-CA'));
                  setStartOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <label className="form-label block mb-1">End Date</label>
          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="form-input flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                {endDate}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate ? new Date(endDate + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                disabled={{ after: new Date(today + 'T00:00:00') }}
                onSelect={(date: Date | undefined) => {
                  if (date) setEndDate(date.toLocaleDateString('en-CA'));
                  setEndOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {dateError && (
        <div className="text-sm text-red-400 mb-4">{dateError}</div>
      )}
      {error && (
        <div className="text-sm text-red-400 mb-4">{error}</div>
      )}

      {!selectedUserId ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            Select an employee to view their timesheet.
          </span>
        </div>
      ) : !dateError ? (
        <TimesheetView
          entries={entries}
          timezone={viewerTimezone}
          startDate={startDate}
          endDate={endDate}
          loading={entriesLoading}
          includeIdleTime={includeIdleTime}
        />
      ) : null}
    </div>
  );
}
