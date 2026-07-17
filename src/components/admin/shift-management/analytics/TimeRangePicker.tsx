'use client';

import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type PresetId,
  type DateRange,
  PRESET_LABELS,
  presetRange,
  yesterdayStr,
} from './analyticsTypes';

interface TimeRangePickerProps {
  preset: PresetId;
  range: DateRange;
  onChange: (preset: PresetId, range: DateRange) => void;
}

/**
 * Preset dropdown + a custom range built from two single Calendars — this
 * codebase has no range-mode date picker, and AdminTimesheets sets the
 * precedent of two independent pickers.
 */
export function TimeRangePicker({ preset, range, onChange }: TimeRangePickerProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  // Data never exists for today — the nightly rollup only covers completed days.
  const maxDate = new Date(yesterdayStr() + 'T00:00:00');

  const label = preset === 'custom' ? 'Custom range' : PRESET_LABELS[preset];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="form-input flex items-center justify-between gap-2"
            style={{ cursor: 'pointer', minWidth: '150px' }}
          >
            <span>{label}</span>
            <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark min-w-[160px]">
          {(Object.keys(PRESET_LABELS) as Array<Exclude<PresetId, 'custom'>>).map(id => (
            <DropdownMenuItem key={id} onSelect={() => onChange(id, presetRange(id))}>
              {PRESET_LABELS[id]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onChange('custom', range)}>
            Custom range…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {preset === 'custom' && (
        <>
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="form-input flex items-center justify-between gap-2"
                style={{ cursor: 'pointer', minWidth: '130px' }}
              >
                {range.start}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                captionLayout="dropdown"
                selected={range.start ? new Date(range.start + 'T00:00:00') : undefined}
                disabled={{ after: maxDate }}
                onSelect={(date) => {
                  if (date) onChange('custom', { ...range, start: date.toLocaleDateString('en-CA') });
                  setStartOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>to</span>

          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="form-input flex items-center justify-between gap-2"
                style={{ cursor: 'pointer', minWidth: '130px' }}
              >
                {range.end}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                captionLayout="dropdown"
                selected={range.end ? new Date(range.end + 'T00:00:00') : undefined}
                disabled={{ after: maxDate }}
                onSelect={(date) => {
                  if (date) onChange('custom', { ...range, end: date.toLocaleDateString('en-CA') });
                  setEndOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
