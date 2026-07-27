'use client';

import { useMemo, useState, type ElementType } from 'react';
import {
  Activity,
  Camera,
  CirclePause,
  CirclePlay,
  ClockAlert,
  ClockCheck,
  Coffee,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { STATE_CONFIG } from '@/lib/stateColors';
import { eventsToSegments, type SegmentState } from '@/lib/utils/sessionSegments';
import { safeTimezone } from '@/lib/utils/timezone';
import type { TimesheetSession } from '@/hooks/useTimesheetData';
import type { SessionEvent, SessionEventType } from '@/types/firestore';

// ─── Event vocabulary ────────────────────────────────────────────────

type EventKind =
  /** A boundary the user (or the OS) caused — it opens a new stretch of session state. */
  | 'milestone'
  /** A routine log entry the client writes on a timer; it changes nothing. */
  | 'marker';

interface EventMeta {
  label: string;
  kind: EventKind;
  /** The state this event puts the session into, when it opens one. */
  opens?: SegmentState;
  color: string;
  Icon: ElementType;
}

// Every colour is read from STATE_CONFIG — the timer subsystem's palette of
// record. Never re-type a state hex here (see DESIGN.md § Colors).
const EVENT_META: Record<SessionEventType, EventMeta> = {
  'clock-in':    { label: 'Clocked in',          kind: 'milestone', opens: 'working',  color: STATE_CONFIG.working.color,       Icon: LogIn },
  'idle-start':  { label: 'Went idle',           kind: 'milestone', opens: 'idle',     color: STATE_CONFIG.idle.color,          Icon: ClockAlert },
  'idle-end':    { label: 'Returned from idle',  kind: 'milestone', opens: 'working',  color: STATE_CONFIG.working.color,       Icon: ClockCheck },
  'break-start': { label: 'Break started',       kind: 'milestone', opens: 'on-break', color: STATE_CONFIG['on-break'].color,   Icon: Coffee },
  'break-end':   { label: 'Break ended',         kind: 'milestone', opens: 'working',  color: STATE_CONFIG.working.color,       Icon: ClockCheck },
  'pause':       { label: 'Timer paused',        kind: 'milestone', opens: 'paused',   color: STATE_CONFIG.paused.color,        Icon: CirclePause },
  'resume':      { label: 'Timer resumed',       kind: 'milestone', opens: 'working',  color: STATE_CONFIG.working.color,       Icon: CirclePlay },
  'clock-out':   { label: 'Clocked out',         kind: 'milestone',                    color: STATE_CONFIG['clocked-out'].color, Icon: LogOut },
  'activity':    { label: 'Activity heartbeat',  kind: 'marker',                       color: 'var(--foreground-secondary)',    Icon: Activity },
  'screenshot':  { label: 'Screenshot captured', kind: 'marker',                       color: 'var(--foreground-secondary)',    Icon: Camera },
};

const UNKNOWN_META: EventMeta = {
  label: 'Unrecognised event',
  kind: 'marker',
  color: 'var(--foreground-secondary)',
  Icon: Activity,
};

function metaFor(type: SessionEventType): EventMeta {
  return EVENT_META[type] ?? UNKNOWN_META;
}

// ─── Formatters ──────────────────────────────────────────────────────

function timeInTZ(ms: number, timezone: string, withSeconds = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(new Date(ms));
}

function dateInTZ(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

function dayKeyInTZ(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Durations down to the second. The analytics `formatDuration` floors anything
 * under a minute to "0m", which would erase exactly the gaps this view exists
 * to expose — the 1s synthetic sleep-gap pause, a 40s idle blip.
 */
function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Derived model ───────────────────────────────────────────────────

interface WalkthroughRow {
  event: SessionEvent;
  meta: EventMeta;
  /** How long the state this event opened lasted, if it opened one. */
  heldMs: number | null;
  /** 0-1 position along the session span. */
  position: number;
}

export interface SessionWalkthroughDialogProps {
  session: TimesheetSession | null;
  /** IANA timezone of the person *viewing* the walkthrough, not the person tracked. */
  timezone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SessionWalkthroughDialog({
  session,
  timezone,
  open,
  onOpenChange,
}: SessionWalkthroughDialogProps) {
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  const model = useMemo(() => {
    if (!session) return null;

    const events = session.events ?? [];
    const ledgerStart = new Date(session.startTime).getTime();
    const ledgerEnd = new Date(session.endTime).getTime();

    // The ribbon must contain every event it draws. A client-stamped event can
    // sit a hair outside the server-stamped session bounds, so widen to the
    // union rather than positioning something off the end of the bar.
    const eventTimes = events.map(e => e.timestamp);
    const spanStart = Math.min(ledgerStart, ...eventTimes);
    const spanEnd = Math.max(ledgerEnd, ...eventTimes);
    const spanMs = Math.max(1, spanEnd - spanStart);

    const segments = eventsToSegments(events, spanStart, spanEnd);
    const positionOf = (ms: number) => (ms - spanStart) / spanMs;

    // Milestones bound each other: the state an event opens runs until the next
    // milestone, or to the end of the session if nothing closes it.
    const milestoneIdx = events
      .map((e, i) => (metaFor(e.type).kind === 'milestone' ? i : -1))
      .filter(i => i >= 0);

    const rows: WalkthroughRow[] = events.map((event, i) => {
      const meta = metaFor(event.type);
      let heldMs: number | null = null;
      if (meta.opens) {
        const next = milestoneIdx.find(j => j > i);
        const until = next === undefined ? spanEnd : events[next].timestamp;
        heldMs = Math.max(0, until - event.timestamp);
      }
      return { event, meta, heldMs, position: positionOf(event.timestamp) };
    });

    // Totals come from the event log, not the ledger: the stored pauseSeconds
    // under-reports (parseBuffer drops a resumed pause), so a ledger-sourced
    // strip would contradict the ribbon sitting directly above it.
    const totals: Record<SegmentState, number> = {
      working: 0, idle: 0, 'on-break': 0, paused: 0,
    };
    for (const s of segments) totals[s.state] += s.endMs - s.startMs;

    return {
      spanStart,
      spanEnd,
      spanMs,
      segments,
      rows,
      totals,
      hasLog: events.length > 0,
      markerCount: rows.filter(r => r.meta.kind === 'marker').length,
      milestonePositions: rows.filter(r => r.meta.kind === 'milestone').map(r => r.position),
      crossesMidnight: dayKeyInTZ(spanStart, timezone) !== dayKeyInTZ(spanEnd, timezone),
    };
  }, [session, timezone]);

  const visibleRows = useMemo(
    () => (model ? model.rows.filter(r => showMarkers || r.meta.kind === 'milestone') : []),
    [model, showMarkers],
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHoverPosition(null);
      setShowMarkers(true);
    }
    onOpenChange(next);
  };

  if (!session || !model) return null;

  const zone = safeTimezone(timezone);
  const axisTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 gap-1.5 px-6 pt-6">
          <DialogTitle>Session walkthrough</DialogTitle>
          <DialogDescription className="tabular-nums">
            {dateInTZ(model.spanStart, zone)} · {timeInTZ(model.spanStart, zone)} →{' '}
            {model.crossesMidnight && `${dateInTZ(model.spanEnd, zone)} `}
            {timeInTZ(model.spanEnd, zone)}
          </DialogDescription>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SessionStatusPill session={session} />
            <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              Times shown in {zone}
            </span>
          </div>
        </DialogHeader>

        {/* ── Totals + ribbon ────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-5">
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-4 py-3"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <Stat label="Session span" value={formatSpan(model.spanMs)} />
            {model.hasLog ? (
              (['working', 'idle', 'on-break', 'paused'] as const).map(state => (
                <Stat
                  key={state}
                  label={STATE_CONFIG[state].label}
                  value={model.totals[state] > 0 ? formatSpan(model.totals[state]) : '—'}
                  dot={STATE_CONFIG[state].color}
                />
              ))
            ) : (
              <span className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>
                No event log — this session&apos;s breakdown cannot be derived.
              </span>
            )}
          </div>

          <div className="mt-4">
            <div
              className="relative h-9 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--border-subtle)' }}
              role="img"
              aria-label={
                model.hasLog
                  ? `Session states from ${timeInTZ(model.spanStart, zone)} to ${timeInTZ(model.spanEnd, zone)}`
                  : 'No event data was recorded for this session'
              }
            >
              {/* One wrapper carries the draw-in so the ribbon reads as a single
                  span running forwards, not as segments popping independently. */}
              <div key={session.sessionId} className="session-ribbon-draw absolute inset-0">
                {model.hasLog ? (
                  model.segments.map((seg, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0"
                      style={{
                        left: `${((seg.startMs - model.spanStart) / model.spanMs) * 100}%`,
                        width: `${((seg.endMs - seg.startMs) / model.spanMs) * 100}%`,
                        background: STATE_CONFIG[seg.state].color,
                        minWidth: '2px',
                      }}
                    />
                  ))
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      // Hatching reads as "unknown", not as a fifth state. An empty
                      // log means the client never uploaded its buffer — it does NOT
                      // mean the user worked the whole span.
                      backgroundImage:
                        'repeating-linear-gradient(135deg, rgba(161,161,170,0.22) 0 6px, transparent 6px 12px)',
                    }}
                  />
                )}

                {/* Milestone ticks: the shape of the session, visible without hover. */}
                {model.milestonePositions.map((p, i) => (
                  <div
                    key={i}
                    className="absolute inset-y-0 w-px"
                    style={{ left: `${p * 100}%`, background: 'rgba(255,255,255,0.35)' }}
                  />
                ))}
              </div>

              {/* Playhead: links the hovered log row back to its moment in time. */}
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
                style={{
                  left: `${(hoverPosition ?? 0) * 100}%`,
                  opacity: hoverPosition === null ? 0 : 1,
                  transition: 'left 120ms ease-out, opacity 120ms ease-out',
                }}
                aria-hidden
              />
            </div>

            <div className="relative mt-1.5 h-4">
              {axisTicks.map(t => (
                <span
                  key={t}
                  className="absolute text-[11px] tabular-nums"
                  style={{
                    left: `${t * 100}%`,
                    transform: t === 0 ? 'none' : t === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                    color: 'var(--foreground-muted)',
                  }}
                >
                  {timeInTZ(model.spanStart + model.spanMs * t, zone)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Event log ──────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Event log
            <span className="ml-2 text-xs font-medium tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
              {model.rows.length} {model.rows.length === 1 ? 'event' : 'events'}
            </span>
          </h3>
          {model.markerCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => setShowMarkers(v => !v)}
              aria-pressed={!showMarkers}
            >
              {showMarkers ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showMarkers ? 'Hide' : 'Show'} routine markers
              <span className="tabular-nums">({model.markerCount})</span>
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {visibleRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {model.hasLog
                ? 'No state changes were recorded — only routine markers, which are hidden.'
                : session.isManual
                  ? 'Manual entry — added by an administrator, so no event log exists.'
                  : 'No events were recorded. The desktop client never uploaded this session’s buffer.'}
            </p>
          ) : (
            <ol className="relative" onMouseLeave={() => setHoverPosition(null)}>
              {/* The rail the event dots thread onto. Positioned on the centre of
                  the icon column: pl-1 (0.25) + time col (4.4) + gap (0.75) + half
                  the 1.5rem icon column. */}
              <div
                className="absolute bottom-4 top-4 w-px"
                style={{ left: '6.15rem', background: 'rgba(255,255,255,0.09)' }}
                aria-hidden
              />
              {visibleRows.map((row, i) => (
                <EventRow
                  key={`${row.event.timestamp}-${row.event.type}-${i}`}
                  row={row}
                  zone={zone}
                  onHover={() => setHoverPosition(row.position)}
                />
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Stat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  // A zero total renders as an em dash rather than a faded "0m" — de-emphasis by
  // opacity would stack on an already-secondary token and push it under the
  // contrast floor (DESIGN.md, The Muted-on-Tint Rule).
  const isEmpty = value === '—';
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden />}
        <span className="text-[11px]" style={{ color: 'var(--foreground-secondary)' }}>
          {label}
        </span>
      </div>
      <div
        className="mt-0.5 text-sm font-semibold tabular-nums"
        style={isEmpty ? { color: 'var(--foreground-muted)' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * How the session ended. `didNotClockOut` is never cleared once a crashed
 * session is later merged, so the pill discriminates on `status` first — see
 * documentation/time-tracking.md.
 */
function SessionStatusPill({ session }: { session: TimesheetSession }) {
  const { text, color } = session.isManual
    ? { text: 'Manual entry', color: '#a1a1aa' }
    : session.status === 'interrupted'
      ? { text: 'Interrupted', color: '#fb923c' }
      : session.didNotClockOut
        ? { text: 'Recovered — no clock out', color: '#facc15' }
        : { text: 'Completed', color: '#4ade80' };

  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {text}
    </span>
  );
}

function EventRow({
  row,
  zone,
  onHover,
}: {
  row: WalkthroughRow;
  zone: string;
  onHover: () => void;
}) {
  const { event, meta, heldMs } = row;
  const isMilestone = meta.kind === 'milestone';
  const Icon = meta.Icon;

  return (
    <li
      className="relative grid grid-cols-[4.4rem_1.5rem_1fr_auto] items-center gap-x-3 rounded-md py-1.5 pl-1 pr-2 transition-colors hover:bg-white/[0.04]"
      onMouseEnter={onHover}
    >
      <time
        className="text-xs tabular-nums"
        style={{ color: 'var(--foreground-secondary)' }}
        dateTime={new Date(event.timestamp).toISOString()}
      >
        {timeInTZ(event.timestamp, zone, true)}
      </time>

      <span className="flex justify-center">
        {isMilestone ? (
          <span
            className="flex size-5 items-center justify-center rounded-full"
            style={{ background: `color-mix(in srgb, ${meta.color} 18%, #0A0A0A)` }}
            aria-hidden
          >
            <Icon className="size-3" style={{ color: meta.color }} />
          </span>
        ) : (
          <span
            className="size-1.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.28)' }}
            aria-hidden
          />
        )}
      </span>

      <span
        className={isMilestone ? 'text-sm' : 'text-xs'}
        style={{ color: isMilestone ? 'var(--foreground)' : 'var(--foreground-secondary)' }}
      >
        {meta.label}
      </span>

      {heldMs !== null && heldMs > 0 && meta.opens && (
        <span className="flex items-center gap-1.5 text-xs tabular-nums" style={{ color: 'var(--foreground-secondary)' }}>
          <span className="size-1.5 rounded-full" style={{ background: STATE_CONFIG[meta.opens].color }} aria-hidden />
          {formatSpan(heldMs)}
        </span>
      )}
    </li>
  );
}
