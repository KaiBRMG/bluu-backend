'use client';

import { useState, useMemo } from 'react';
import { useTimesheetData } from '@/hooks/useTimesheetData';
import TimesheetView from './TimesheetView';
import { RefreshCcw } from 'lucide-react';

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

export default function UserTimesheet() {
  const yesterday = useMemo(() => addDays(toDateString(new Date()), -1), []);
  const [selectedDate, setSelectedDate] = useState(yesterday);

  // Selected date is the END date (shown at top); show 7 days ending on that date.
  // Today is never included — timesheets are only available from yesterday back.
  const { startDate, endDate } = useMemo(() => ({
    startDate: addDays(selectedDate, -6),
    endDate: selectedDate,
  }), [selectedDate]);

  const { entries, timezone, includeIdleTime, loading, error } = useTimesheetData(null, startDate, endDate);

  return (
    <div
      className="rounded-lg p-6"
      style={{
        background: 'var(--sidebar-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
          Timesheet
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="p-1.5 rounded-md transition-colors hover:bg-white/10"
            title="Refresh timesheet"
          >
            <RefreshCcw width={16} height={16} />
          </button>
          <input
            type="date"
            className="form-input text-sm"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) setSelectedDate(e.target.value);
            }}
            max={yesterday}
            required
          />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 mb-4">{error}</div>
      )}

      <TimesheetView
        entries={entries}
        timezone={timezone}
        startDate={startDate}
        endDate={endDate}
        loading={loading}
        includeIdleTime={includeIdleTime}
      />
    </div>
  );
}
