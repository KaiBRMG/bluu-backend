'use client';

import { useState, useMemo } from 'react';
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

/**
 * One person's timesheet over a date range — the person sheet's Timesheet
 * section. The person is chosen by the sheet, so there is no picker here.
 */
interface AdminTimesheetsProps {
  selectedUserId: string;
  /** Last day of the opening range (YYYY-MM-DD); the range runs 7 days to it. */
  initialDate?: string;
}

export default function AdminTimesheets({
  selectedUserId,
  initialDate,
}: AdminTimesheetsProps) {
  const { userData: viewerData } = useUserData();
  const viewerTimezone = viewerData?.timezone || 'UTC';
  const today = toDateString(new Date());
  const openingEnd = initialDate && initialDate < today ? initialDate : today;
  const [startDate, setStartDate] = useState(addDays(openingEnd, -6));
  const [endDate, setEndDate] = useState(openingEnd);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

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

  const { entries, sessions, loading: entriesLoading, error } = useTimesheetData(
    selectedUserId,
    dateError ? null : startDate,
    dateError ? null : endDate,
    viewerTimezone,
  );

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
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
          sessions={sessions}
          timezone={viewerTimezone}
          startDate={startDate}
          endDate={endDate}
          loading={entriesLoading}
        />
      ) : null}
    </div>
  );
}
