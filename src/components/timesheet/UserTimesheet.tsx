'use client';

import { useState, useMemo } from 'react';
import { useTimesheetData } from '@/hooks/useTimesheetData';
import { useUserData } from '@/hooks/useUserData';
import TimesheetView from './TimesheetView';
import { RefreshCcw, ChevronDownIcon } from 'lucide-react';
import { Button } from "@/components/ui/button";
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

export default function UserTimesheet() {
  const { userData } = useUserData();
  const userTimezone = userData?.timezone || 'UTC';

  const yesterday = useMemo(() => addDays(toDateString(new Date()), -1), []);
  const [selectedDate, setSelectedDate] = useState(yesterday);
  const [dateOpen, setDateOpen] = useState(false);

  // Selected date is the END date (shown at top); show 7 days ending on that date.
  // Today is never included — timesheets are only available from yesterday back.
  const { startDate, endDate } = useMemo(() => ({
    startDate: addDays(selectedDate, -6),
    endDate: selectedDate,
  }), [selectedDate]);

  const { entries, timezone, includeIdleTime, loading, error } = useTimesheetData(null, startDate, endDate, userTimezone);

  return (
    <div
      className="rounded-lg p-6"
      style={{
        background: 'var(--container-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold tracking-tight">
          Timesheet
        </h2>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.location.reload()}
            variant="ghost"
            size="icon"
            title="Refresh timesheet"
          >
            <RefreshCcw width={16} height={16} />
          </Button>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="form-input text-sm flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                {selectedDate}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                disabled={{ after: new Date(yesterday + 'T00:00:00') }}
                onSelect={(date: Date | undefined) => {
                  if (date) setSelectedDate(date.toLocaleDateString('en-CA'));
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
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
