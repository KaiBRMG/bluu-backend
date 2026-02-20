'use client';

import { useState, useMemo } from 'react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useTimesheetData } from '@/hooks/useTimesheetData';
import TimesheetView from '@/components/timesheet/TimesheetView';

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

export default function AdminTimesheets() {
  const { users, loading: usersLoading } = useAdminUsers();
  const today = toDateString(new Date());

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(addDays(today, -6));
  const [endDate, setEndDate] = useState(today);

  // Filter to users with timeTracking enabled; fall back to all users if none have it set
  const timeTrackedUsers = useMemo(() => {
    const tracked = users.filter((u) => u.timeTracking === true);
    return tracked.length > 0 ? tracked : users;
  }, [users]);

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
  );

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
        Timesheets
      </h2>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="form-label block mb-1">Employee</label>
          <select
            className="form-input"
            value={selectedUserId || ''}
            onChange={(e) => setSelectedUserId(e.target.value || null)}
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
          <input
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => { if (e.target.value) setStartDate(e.target.value); }}
            max={today}
            required
          />
        </div>

        <div>
          <label className="form-label block mb-1">End Date</label>
          <input
            type="date"
            className="form-input"
            value={endDate}
            onChange={(e) => { if (e.target.value) setEndDate(e.target.value); }}
            max={today}
            required
          />
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
          timezone={timezone}
          startDate={startDate}
          endDate={endDate}
          loading={entriesLoading}
          includeIdleTime={includeIdleTime}
        />
      ) : null}
    </div>
  );
}
