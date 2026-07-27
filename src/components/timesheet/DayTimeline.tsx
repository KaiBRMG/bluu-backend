'use client';

import { useRef, useState, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { STATE_CONFIG } from '@/lib/stateColors';
import type { TimesheetEntry } from '@/hooks/useTimesheetData';

type SegmentState = TimesheetEntry['state'];

interface Segment {
  leftPct: number;
  widthPct: number;
  state: SegmentState;
  sessionId: string;
  startTime: Date;
  endTime: Date;
  // For tooltip: may span multiple merged entries
  tooltipStartTime: Date;
  tooltipEndTime: Date;
}

interface DayTimelineProps {
  date: string; // YYYY-MM-DD
  entries: TimesheetEntry[];
  timezone: string;
  /**
   * Opt-in: makes each segment a control that opens the session walkthrough.
   * Omitted, the bar stays a read-only visualisation (the employee's own
   * timesheet renders it that way).
   */
  onSessionClick?: (sessionId: string) => void;
}

import { getDayBoundsUTC } from '@/lib/utils/timezone';

function formatTimeInTZ(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function DayTimeline({ date, entries, timezone, onSessionClick }: DayTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  // Roving tabindex: the whole day bar is one tab stop, arrows walk its
  // segments. One stop per segment would put hundreds of them in a month view.
  const [focusIndex, setFocusIndex] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const interactive = Boolean(onSessionClick);

  const { segments } = useMemo(() => {
    const { start, end } = getDayBoundsUTC(date, timezone);
    const duration = end - start + 1;
    const segs: Segment[] = [];

    for (const entry of entries) {
      const entryStart = new Date(entry.createdTime).getTime();
      const entryEnd = new Date(entry.lastTime).getTime();

      // Clamp to day boundaries
      const clampedStart = Math.max(entryStart, start);
      const clampedEnd = Math.min(entryEnd, end);

      if (clampedStart >= clampedEnd) continue;

      const leftPct = ((clampedStart - start) / duration) * 100;
      const widthPct = ((clampedEnd - clampedStart) / duration) * 100;

      segs.push({
        leftPct,
        widthPct,
        state: entry.state,
        sessionId: entry.sessionId,
        startTime: new Date(clampedStart),
        endTime: new Date(clampedEnd),
        tooltipStartTime: new Date(clampedStart),
        tooltipEndTime: new Date(clampedEnd),
      });
    }

    // Merge consecutive segments of the same state where the boundary falls within the same minute
    for (let i = segs.length - 1; i > 0; i--) {
      const prev = segs[i - 1];
      const curr = segs[i];
      if (
        prev.state === curr.state &&
        Math.floor(prev.endTime.getTime() / 60000) === Math.floor(curr.startTime.getTime() / 60000)
      ) {
        prev.tooltipEndTime = curr.tooltipEndTime;
        curr.tooltipStartTime = prev.tooltipStartTime;
      }
    }

    return { segments: segs };
  }, [date, entries, timezone]);

  // Show the tooltip against the element itself when focus arrives by keyboard;
  // the pointer position is meaningless then.
  const anchorToElement = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
  };

  const moveFocus = (from: number, delta: number) => {
    const next = Math.min(segments.length - 1, Math.max(0, from + delta));
    if (next === from) return;
    setFocusIndex(next);
    const el = barRef.current?.querySelectorAll<HTMLElement>('[data-segment]')[next];
    el?.focus();
  };

  const activeSegment = hoveredIndex !== null ? segments[hoveredIndex] : null;

  return (
    <div
      ref={barRef}
      className="relative h-7 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--border-subtle)' }}
      {...(interactive
        ? { role: 'group', 'aria-label': `Sessions on ${date} — activate a segment to view its timeline` }
        : {})}
    >
      {segments.map((seg, i) => {
        const shared = {
          'data-segment': true,
          className: 'absolute top-0 bottom-0 transition-opacity',
          style: {
            left: `${seg.leftPct}%`,
            width: `${seg.widthPct}%`,
            background: STATE_CONFIG[seg.state].color,
            opacity: hoveredIndex === i ? 0.85 : 1,
            minWidth: '2px',
          } as CSSProperties,
          onMouseEnter: (e: ReactMouseEvent) => {
            setHoveredIndex(i);
            setAnchor({ x: e.clientX, y: e.clientY });
          },
          onMouseMove: (e: ReactMouseEvent) => {
            setAnchor({ x: e.clientX, y: e.clientY });
          },
          onMouseLeave: () => setHoveredIndex(null),
        };

        if (!interactive) return <div key={i} {...shared} />;

        return (
          <button
            key={i}
            type="button"
            {...shared}
            // Focus lives inside an overflow-hidden pill, so a ring would be
            // clipped — an inset outline stays visible.
            className={`${shared.className} cursor-pointer focus-visible:outline-2 focus-visible:outline-white focus-visible:-outline-offset-2`}
            tabIndex={i === Math.min(focusIndex, segments.length - 1) ? 0 : -1}
            aria-label={`${STATE_CONFIG[seg.state].label}, ${formatTimeInTZ(seg.tooltipStartTime, timezone)} to ${formatTimeInTZ(seg.tooltipEndTime, timezone)}. View session timeline.`}
            onFocus={(e) => {
              setFocusIndex(i);
              setHoveredIndex(i);
              anchorToElement(e.currentTarget);
            }}
            onBlur={() => setHoveredIndex(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(i, 1); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(i, -1); }
              else if (e.key === 'Home') { e.preventDefault(); moveFocus(i, -segments.length); }
              else if (e.key === 'End') { e.preventDefault(); moveFocus(i, segments.length); }
            }}
            onClick={() => onSessionClick?.(seg.sessionId)}
          />
        );
      })}

      {/* Tooltip */}
      {activeSegment && (
        <div
          className="pointer-events-none fixed z-[var(--z-overlay)] rounded-lg px-3 py-2 text-xs"
          style={{
            left: anchor.x + 12,
            top: anchor.y - 40,
            background: 'var(--background)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--foreground)',
          }}
          role="tooltip"
        >
          <div className="mb-1 flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: STATE_CONFIG[activeSegment.state].color }}
            />
            <span className="font-medium">{STATE_CONFIG[activeSegment.state].label}</span>
          </div>
          <div className="tabular-nums" style={{ color: 'var(--foreground-secondary)' }}>
            {formatTimeInTZ(activeSegment.tooltipStartTime, timezone)} — {formatTimeInTZ(activeSegment.tooltipEndTime, timezone)}
          </div>
          {interactive && (
            <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: 'var(--border-subtle)', color: 'var(--foreground-muted)' }}>
              Click to view timeline
            </div>
          )}
        </div>
      )}
    </div>
  );
}
