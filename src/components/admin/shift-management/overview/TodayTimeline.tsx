'use client';

import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { SURFACE } from '@/lib/surfaces';
import { STATE_CONFIG } from '@/lib/stateColors';
import { cn } from '@/lib/utils';
import {
  formatClock,
  formatSpan,
  LIVE_STATES,
  shiftStanding,
  type LiveSession,
  type OverviewPerson,
  type OverviewSession,
  type OverviewShift,
  type ShiftOverviewResponse,
} from '@/lib/shiftOverview';
import { LiveStateLabel, PersonAvatar } from './personUi';

const HOUR = 60 * 60 * 1000;

/** "No event log" — unknown, never drawn as worked (time-tracking.md trap 1). */
const UNKNOWN_FILL =
  'repeating-linear-gradient(135deg, rgba(161,161,170,0.45) 0 3px, transparent 3px 6px)';

interface Scale {
  left: (ms: number) => string;
  width: (a: number, b: number) => string;
}

interface Row {
  person: OverviewPerson;
  shifts: OverviewShift[];
  sessions: OverviewSession[];
  live: LiveSession | undefined;
  firstAt: number;
  clockedMs: number;
}

interface TodayTimelineProps {
  data: ShiftOverviewResponse | null;
  live: LiveSession[];
  people: Map<string, OverviewPerson>;
  now: number;
  loading: boolean;
  onOpen: (uid: string) => void;
}

export function TodayTimeline({ data, live, people, now, loading, onOpen }: TodayTimelineProps) {
  const model = useMemo(() => {
    if (!data) return null;
    const { start: dayStart, end: dayEnd } = data.todayBounds;
    const liveByUser = new Map(live.map(s => [s.userId, s]));
    // Bucket once by person — the row loop then reads, never filters.
    const shiftsBy = new Map<string, OverviewShift[]>();
    for (const s of data.shifts) {
      if (s.end > dayStart && s.start < dayEnd) shiftsBy.set(s.userId, [...(shiftsBy.get(s.userId) ?? []), s]);
    }
    const sessionsBy = new Map<string, OverviewSession[]>();
    for (const s of data.sessions) sessionsBy.set(s.userId, [...(sessionsBy.get(s.userId) ?? []), s]);
    const uids = new Set([...shiftsBy.keys(), ...sessionsBy.keys(), ...liveByUser.keys()]);

    const rows: Row[] = [];
    for (const uid of uids) {
      const person = people.get(uid);
      if (!person) continue;
      const shifts = shiftsBy.get(uid) ?? [];
      const sessions = sessionsBy.get(uid) ?? [];
      const l = liveByUser.get(uid);
      const marks = [
        ...shifts.map(s => s.start),
        ...sessions.map(s => s.start),
        ...(l ? [l.startTime.getTime()] : []),
      ];
      let clockedMs = 0;
      for (const s of sessions) clockedMs += Math.max(0, Math.min(s.end, dayEnd) - Math.max(s.start, dayStart));
      if (l) clockedMs += Math.max(0, now - Math.max(l.startTime.getTime(), dayStart));
      rows.push({ person, shifts, sessions, live: l, firstAt: Math.min(...marks), clockedMs });
    }
    // Stable, retrieval-friendly order: by when the day starts for them, then name.
    rows.sort((a, b) => a.firstAt - b.firstAt || a.person.displayName.localeCompare(b.person.displayName));

    // Axis: the span the day actually covers, padded to whole hours, at least 8h.
    const points = rows.flatMap(r => [
      ...r.shifts.flatMap(s => [s.start, s.end]),
      ...r.sessions.flatMap(s => [s.start, s.end]),
      ...(r.live ? [r.live.startTime.getTime()] : []),
    ]);
    points.push(now);
    let axisStart = Math.max(dayStart, Math.floor((Math.min(...points) - HOUR / 2) / HOUR) * HOUR);
    let axisEnd = Math.min(dayEnd, Math.ceil((Math.max(...points) + HOUR / 2) / HOUR) * HOUR);
    if (axisEnd - axisStart < 8 * HOUR) {
      const pad = (8 * HOUR - (axisEnd - axisStart)) / 2;
      axisStart = Math.max(dayStart, axisStart - pad);
      axisEnd = Math.min(dayEnd, axisStart + 8 * HOUR);
    }
    const span = axisEnd - axisStart;
    const stepHours = span > 14 * HOUR ? 3 : span > 9 * HOUR ? 2 : 1;
    // Ticks sit on the viewer's local hours, which are not UTC hours in a
    // half-hour zone — find the first local :00 at or after the axis start.
    const tz = data.timezone;
    const minuteOf = (ms: number) => Number(formatClock(ms, tz).slice(3, 5));
    const hourOf = (ms: number) => Number(formatClock(ms, tz).slice(0, 2));
    let first = Math.ceil(axisStart / (15 * 60 * 1000)) * 15 * 60 * 1000;
    while (minuteOf(first) !== 0 && first < axisStart + HOUR) first += 15 * 60 * 1000;
    const ticks: number[] = [];
    for (let t = first; t <= axisEnd; t += HOUR) {
      if (hourOf(t) % stepHours === 0) ticks.push(t);
    }
    // One clamp-and-normalise; `left`/`width` are both differences of it.
    const frac = (ms: number) => (Math.min(Math.max(ms, axisStart), axisEnd) - axisStart) / span;
    const scale: Scale = {
      left: ms => `${(frac(ms) * 100).toFixed(3)}%`,
      width: (a, b) => `${((frac(b) - frac(a)) * 100).toFixed(3)}%`,
    };
    return { rows, ticks, scale, nowVisible: now >= axisStart && now <= axisEnd };
  }, [data, live, people, now]);

  const tz = data?.timezone ?? 'UTC';

  return (
    <section aria-labelledby="today-title" className={`rounded-xl ${SURFACE}`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 pb-3">
        <h2 id="today-title" className="text-sm font-semibold">Today</h2>
        <Legend />
      </header>

      {loading || !model ? (
        <div className="space-y-2 px-4 pb-4" aria-hidden>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-7 w-full rounded-md" />)}
        </div>
      ) : model.rows.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-zinc-400">No one is scheduled or clocked in today.</p>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="min-w-[44rem] px-2">
            {/* Axis */}
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_8.5rem] items-end gap-3 px-2 pb-1">
              <span />
              <div className="relative h-4">
                {model.ticks.map(t => (
                  <span
                    key={t}
                    className="absolute -translate-x-1/2 text-[11px] tabular-nums text-zinc-400"
                    style={{ left: model.scale.left(t) }}
                  >
                    {formatClock(t, tz)}
                  </span>
                ))}
              </div>
              <span className="text-right text-[11px] text-zinc-400">Clocked today</span>
            </div>

            <ul>
              {model.rows.map(row => (
                <TimelineRow
                  key={row.person.uid}
                  row={row}
                  tz={tz}
                  now={now}
                  ticks={model.ticks}
                  nowVisible={model.nowVisible}
                  scale={model.scale}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function TimelineRow({
  row, tz, now, ticks, nowVisible, scale, onOpen,
}: {
  row: Row;
  tz: string;
  now: number;
  ticks: number[];
  nowVisible: boolean;
  scale: Scale;
  onOpen: (uid: string) => void;
}) {
  const { person, shifts, sessions, live } = row;
  const liveStart = live?.startTime.getTime();
  const stateSince = live?.lastUpdated.getTime();

  const summary = [
    shifts.length
      ? `Scheduled ${shifts.map(s => `${formatClock(s.start, tz)}–${formatClock(s.end, tz)}`).join(', ')}`
      : 'Not scheduled',
    ...sessions.map(s => `clocked ${formatClock(s.start, tz)}–${formatClock(s.end, tz)}`),
    live ? `clocked in since ${formatClock(liveStart!, tz)}, now ${STATE_CONFIG[live.currentState].label.toLowerCase()}` : null,
  ].filter(Boolean).join('; ');

  return (
    <li className="relative grid grid-cols-[11rem_minmax(0,1fr)_8.5rem] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-[120ms] hover:bg-white/[0.055] focus-within:bg-white/[0.055]">
      <button
        type="button"
        onClick={() => onOpen(person.uid)}
        aria-label={`Open ${person.displayName}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      />
      <div className="pointer-events-none flex min-w-0 items-center gap-2">
        <PersonAvatar displayName={person.displayName} photoURL={person.photoURL} />
        <span className="truncate text-sm">{person.displayName}</span>
      </div>

      <div className="pointer-events-none relative h-7" role="img" aria-label={summary}>
        {/* Hour gridlines */}
        {ticks.map(t => (
          <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: scale.left(t) }} />
        ))}

        {/* Scheduled windows */}
        {shifts.map(s => {
          const standing = shiftStanding(s, !!live, now);
          const missed = standing === 'missed' || standing === 'not-in';
          const onLeave = standing === 'on-leave';
          return (
            <span
              key={s.key}
              className={cn(
                'absolute inset-y-0 flex items-center rounded-md border border-dashed px-1.5',
                missed ? 'border-red-400/70 bg-red-500/[0.08]'
                  : onLeave ? 'border-white/25 bg-white/[0.04]'
                  : 'border-white/30',
              )}
              style={{ left: scale.left(s.start), width: scale.width(s.start, s.end) }}
            >
              {(missed || onLeave) && (
                <span className={cn('truncate text-[10px] font-medium', missed ? 'text-red-300' : 'text-zinc-400')}>
                  {missed ? 'Missed' : 'On leave'}
                </span>
              )}
            </span>
          );
        })}

        {/* Closed sessions, by state */}
        {sessions.map(s =>
          s.spans.length === 0 ? (
            <span
              key={s.sessionId}
              className="absolute top-[7px] bottom-[7px] rounded-[3px]"
              style={{ left: scale.left(s.start), width: scale.width(s.start, s.end), backgroundImage: UNKNOWN_FILL }}
            />
          ) : (
            s.spans.map(([a, b, state], i) => (
              <span
                key={`${s.sessionId}:${i}`}
                className="absolute top-[7px] bottom-[7px]"
                style={{ left: scale.left(a), width: scale.width(a, b), background: STATE_CONFIG[state].color }}
              />
            ))
          ),
        )}

        {/* Live session: neutral until its log arrives at clock-out; the current
            state is exact from its last transition, so that tail takes its hue. */}
        {live && liveStart !== undefined && (
          <>
            <span
              className="absolute top-[7px] bottom-[7px] rounded-l-[3px] bg-white/[0.2]"
              style={{ left: scale.left(liveStart), width: scale.width(liveStart, now) }}
            />
            {live.currentState === 'working' ? (
              <span
                className="absolute top-[5px] bottom-[5px] w-[3px] -translate-x-full rounded-[2px]"
                style={{ left: scale.left(now), background: STATE_CONFIG.working.color }}
              />
            ) : (
              <span
                className="absolute top-[7px] bottom-[7px]"
                style={{
                  left: scale.left(Math.max(stateSince ?? now, liveStart)),
                  width: scale.width(Math.max(stateSince ?? now, liveStart), now),
                  background: STATE_CONFIG[live.currentState].color,
                }}
              />
            )}
          </>
        )}

        {nowVisible && (
          <span aria-hidden className="absolute -inset-y-1.5 w-px bg-white/60" style={{ left: scale.left(now) }} />
        )}
      </div>

      <div className="pointer-events-none flex flex-col items-end gap-0.5">
        {live ? (
          <LiveStateLabel session={live} />
        ) : (
          <span className="text-xs text-zinc-400">{offlineLabel(row, now, tz)}</span>
        )}
        <span className="text-[11px] tabular-nums text-zinc-400">
          {row.clockedMs > 0 ? formatSpan(row.clockedMs) : '—'}
        </span>
      </div>
    </li>
  );
}

/** What a row with no live session is doing, in words — colour is never the only cue. */
function offlineLabel(row: Row, now: number, tz: string): string {
  if (row.sessions.length) return 'Clocked out';
  const upcoming = row.shifts.filter(s => s.start > now).sort((a, b) => a.start - b.start)[0];
  const standings = row.shifts.map(s => shiftStanding(s, false, now));
  if (standings.includes('missed')) return 'Missed shift';
  if (upcoming && standings.every(st => st === 'upcoming' || st === 'on-leave')) {
    return `Starts ${formatClock(upcoming.start, tz)}`;
  }
  return standings.length > 0 && standings.every(st => st === 'on-leave') ? 'On leave' : 'Not clocked in';
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400" aria-label="Legend">
      {LIVE_STATES.map(s => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-3 rounded-[2px]" style={{ background: STATE_CONFIG[s].color }} />
          {STATE_CONFIG[s].label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-2 w-3 rounded-[2px] bg-white/[0.2]" />
        Live, detail at clock-out
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-2.5 w-3 rounded-[3px] border border-dashed border-white/40" />
        Scheduled
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-2 w-3 rounded-[2px]" style={{ backgroundImage: UNKNOWN_FILL }} />
        No event log
      </li>
    </ul>
  );
}
