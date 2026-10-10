'use client';

import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { LegendSwatch, LoadError } from '@/components/buddyx/buddyxUi';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { cn } from '@/lib/utils';
import { STATE_CONFIG } from '@/lib/stateColors';
import { STATUS_HEX } from '@/lib/campaignTracking';
import { SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import { formatDuration } from '@/lib/buddyx/analyticsFormat';
import { HOUR_MS } from '@/lib/buddyx/coverage';
import type { ShiftDetail } from '@/lib/buddyx/analyticsTypes';

/**
 * One shift at minute grain — the report's evidence view. Five lanes share one
 * time axis, so a reader can line up "clocked in and working" against "online
 * in BuddyX", "typing", and "what looked machine-made":
 *
 * 1. **Bluu** — the time-tracking state, in the timer's own palette
 *    (`STATE_CONFIG`), over a dashed outline of the scheduled shift.
 * 2. **BuddyX** — online share per hour (BuddyX's finest grain), one hue at
 *    full strength, the share as height; an hour with no data is a dashed
 *    outline, never drawn as zero.
 * 3. **Typing** — key presses per minute (√-scaled so a burst does not flatten
 *    the rest). A gap is "not measured", not "no typing".
 * 4. **Flags** — machine-regular rhythm, modifier-only input, unchanged screen.
 * 5. **Captures** — each screenshot; an unchanged one is ringed.
 *
 * The lane hues are the only colour on the card and each one means its lane.
 */

const FLAG_HUE = {
  regular: STATUS_HEX.orange,
  'modifier-only': STATUS_HEX.yellow,
  static: STATUS_HEX.zinc,
} as const;
const FLAG_LABEL = {
  regular: 'Machine-regular typing',
  'modifier-only': 'Modifier / filler keys only',
  static: 'Screen unchanged',
} as const;

/**
 * Online share → bar height, at full strength. Encoding the amount in opacity
 * instead would need a ~0.78 floor to keep a barely-online hour at 3:1 against
 * the card (WCAG 1.4.11), leaving no visible range; full-strength
 * `SEQUENTIAL_COLOR` measures 4.3:1 at any height. The floor keeps "a little"
 * from reading as empty track.
 */
const ONLINE_HEIGHT_FLOOR = 0.25;

export function ShiftTimeline({ uid, startMs, endMs, scheduled }: { uid: string; startMs: number; endMs: number; scheduled: boolean }) {
  const url = `/api/analytics/chatters/${encodeURIComponent(uid)}/shift?start=${startMs}&end=${endMs}${scheduled ? '&scheduled=1' : ''}`;
  const { data, loading, error, reload } = useBuddyxAnalytics<ShiftDetail>(url);
  if (loading && !data) return <Skeleton className="h-52 rounded-lg" />;
  if (error && !data) return <LoadError error={error} onRetry={() => void reload(true)} />;
  if (!data) return null;
  return <TimelineBody detail={data} />;
}

function TimelineBody({ detail }: { detail: ShiftDetail }) {
  const { timezone } = useViewerTimezone();
  const span = Math.max(1, detail.toMs - detail.fromMs);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - detail.fromMs) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.15, ((Math.min(b, detail.toMs) - Math.max(a, detail.fromMs)) / span) * 100)}%`;
  const clock = useMemo(
    () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone }),
    [timezone],
  );
  const t = (ms: number) => clock.format(ms);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const step = span > 10 * HOUR_MS ? 2 * HOUR_MS : HOUR_MS;
    for (let h = Math.ceil(detail.fromMs / step) * step; h <= detail.toMs; h += step) out.push(h);
    return out;
  }, [detail.fromMs, detail.toMs, span]);

  const maxKeys = Math.max(1, ...detail.keysPerMinute);
  const measured = detail.keysPerMinute.some(n => n >= 0);
  const worked = detail.segments.filter(s => s.state === 'working').reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const online = detail.hours.reduce((sum, h) => sum + (h.onlineMs ?? 0), 0);
  const flaggedMinutes = (kind: keyof typeof FLAG_HUE) =>
    Math.round(detail.intervals.filter(i => i.kind === kind).reduce((s, i) => s + (i.endMs - i.startMs), 0) / 60_000);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px]">
        {/* Bluu */}
        <span className="pt-1 text-zinc-400">Bluu</span>
        <div
          className="session-ribbon-draw relative h-5 rounded-sm bg-white/[0.03]"
          role="img"
          aria-label={`Clocked working ${formatDuration(worked)} between ${t(detail.fromMs)} and ${t(detail.toMs)}.`}
        >
          {detail.scheduled && (
            <span
              className="absolute inset-y-0 rounded-sm border border-dashed border-zinc-500"
              style={{ left: pct(detail.scheduled.startMs), width: width(detail.scheduled.startMs, detail.scheduled.endMs) }}
              title={`Scheduled ${t(detail.scheduled.startMs)}–${t(detail.scheduled.endMs)}`}
              aria-hidden
            />
          )}
          {detail.segments.map((s, i) => (
            <span
              key={i}
              className="absolute inset-y-1 rounded-[2px]"
              style={{ left: pct(s.startMs), width: width(s.startMs, s.endMs), background: STATE_CONFIG[s.state].color }}
              title={`${STATE_CONFIG[s.state].label} ${t(s.startMs)}–${t(s.endMs)}`}
              aria-hidden
            />
          ))}
        </div>

        {/* BuddyX */}
        <span className="pt-1 text-zinc-400">BuddyX</span>
        <div
          className="relative h-6 rounded-sm bg-white/[0.03]"
          role="img"
          aria-label={`Online in BuddyX ${formatDuration(online)} across the hours shown.`}
        >
          {detail.hours.map(h => {
            const share = h.onlineMs === null ? null : h.onlineMs / HOUR_MS;
            // No data is an outline, not a fill: "unknown" must look different
            // from "zero" (empty track) and from "some" (a fill).
            return (
              <span
                key={h.startMs}
                className={cn(
                  'absolute',
                  share === null ? 'inset-y-1 rounded-[2px] border border-dashed border-zinc-500' : 'bottom-0.5 border-r border-[var(--card)]',
                )}
                style={{
                  left: pct(h.startMs),
                  width: width(h.startMs, h.startMs + HOUR_MS),
                  background: share !== null && share > 0 ? SEQUENTIAL_COLOR : 'transparent',
                  ...(share !== null && { height: share > 0 ? `${(ONLINE_HEIGHT_FLOOR + (1 - ONLINE_HEIGHT_FLOOR) * Math.min(1, share)) * 85}%` : 0 }),
                }}
                title={
                  share === null
                    ? `${t(h.startMs)}: no hourly BuddyX data yet`
                    : `${t(h.startMs)}: online ${formatDuration(h.onlineMs)} · ${h.messages ?? 0} messages`
                }
                aria-hidden
              />
            );
          })}
        </div>

        {/* Typing */}
        <span className="pt-1 text-zinc-400">Typing</span>
        <div
          className="relative h-8 rounded-sm bg-white/[0.03]"
          role="img"
          aria-label={measured ? 'Key presses per minute.' : 'Typing was not measured for this shift.'}
        >
          {measured ? (
            detail.keysPerMinute.map((n, i) =>
              n > 0 ? (
                <span
                  key={i}
                  className="absolute bottom-0 bg-zinc-300"
                  style={{
                    left: pct(detail.fromMs + i * 60_000),
                    width: width(detail.fromMs + i * 60_000, detail.fromMs + (i + 1) * 60_000),
                    height: `${Math.max(8, Math.sqrt(n / maxKeys) * 100)}%`,
                  }}
                  title={`${t(detail.fromMs + i * 60_000)}: ${n} key ${n === 1 ? 'press' : 'presses'}`}
                  aria-hidden
                />
              ) : null,
            )
          ) : (
            <span className="absolute inset-0 grid place-items-center text-zinc-400">Not measured — input monitoring was off</span>
          )}
        </div>

        {/* Flags */}
        <span className="pt-1 text-zinc-400">Flags</span>
        <div className="relative h-5 rounded-sm bg-white/[0.03]" role="img" aria-label={flagSummary(flaggedMinutes)}>
          {detail.intervals.map((iv, i) => (
            <span
              key={i}
              className="absolute inset-y-1 rounded-[2px]"
              style={{ left: pct(iv.startMs), width: width(iv.startMs, iv.endMs), background: FLAG_HUE[iv.kind], opacity: iv.kind === 'static' ? 0.7 : 1 }}
              title={`${FLAG_LABEL[iv.kind]} ${t(iv.startMs)}–${t(iv.endMs)}`}
              aria-hidden
            />
          ))}
        </div>

        {/* Captures */}
        <span className="pt-0.5 text-zinc-400">Captures</span>
        <div className="relative h-4" role="img" aria-label={`${detail.captures.length} screenshots, ${detail.captures.filter(c => c.unchanged).length} unchanged from the one before.`}>
          {detail.captures.map((c, i) => (
            <span
              key={i}
              className={cn(
                'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                c.unchanged ? 'border border-orange-400 bg-transparent' : 'bg-zinc-400',
              )}
              style={{ left: pct(c.atMs) }}
              title={`${t(c.atMs)} · activity ${c.activityPercent ?? '—'}%${c.unchanged ? ' · unchanged' : ''}`}
              aria-hidden
            />
          ))}
        </div>

        {/* Axis */}
        <span aria-hidden />
        <div className="relative h-4 text-zinc-400 tabular-nums" aria-hidden>
          {ticks.map(h => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h) }}>
              {t(h)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400" aria-hidden>
        {(['working', 'idle', 'on-break', 'paused'] as const).map(s => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <LegendSwatch color={STATE_CONFIG[s].color} />
            {STATE_CONFIG[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <LegendSwatch color={SEQUENTIAL_COLOR} /> Online (taller = more of the hour)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[3px] border border-dashed border-zinc-500" /> No hourly data yet
        </span>
        {(Object.keys(FLAG_HUE) as Array<keyof typeof FLAG_HUE>).map(k => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <LegendSwatch color={FLAG_HUE[k]} /> {FLAG_LABEL[k]}
          </span>
        ))}
      </div>

      <StretchList detail={detail} format={t} />
      <MonitoringNote detail={detail} />
      {detail.captures.some(c => c.thumbnails !== null) && <CaptureStrip detail={detail} format={t} />}
    </div>
  );
}

function flagSummary(minutes: (k: 'regular' | 'modifier-only' | 'static') => number): string {
  const parts = (['regular', 'modifier-only', 'static'] as const)
    .map(k => ({ k, m: minutes(k) }))
    .filter(x => x.m > 0)
    .map(x => `${FLAG_LABEL[x.k]} ${formatDuration(x.m * 60_000)}`);
  return parts.length ? `Flagged: ${parts.join(', ')}.` : 'Nothing flagged in this shift.';
}

/**
 * The timeline's findings as text — when each flagged stretch and each run of
 * unchanged screens happened. The lanes above are a picture whose exact times
 * live in hover titles; this is the same evidence for the keyboard, a screen
 * reader, and anyone who wants to read rather than hover.
 */
function StretchList({ detail, format }: { detail: ShiftDetail; format: (ms: number) => string }) {
  const stretches = [...detail.intervals].sort((a, b) => a.startMs - b.startMs);
  if (stretches.length === 0) return <p className="text-[11px] text-zinc-400">Nothing flagged in this shift.</p>;
  return (
    <div>
      <h3 className="text-xs font-medium text-zinc-400">Flagged stretches</h3>
      <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
        {stretches.map((iv, i) => (
          <li key={i} className="flex items-center gap-1.5 tabular-nums">
            <LegendSwatch color={FLAG_HUE[iv.kind]} />
            <span>
              {format(iv.startMs)}–{format(iv.endMs)}
              <span className="text-zinc-400"> · {FLAG_LABEL[iv.kind]} · {formatDuration(iv.endMs - iv.startMs)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonitoringNote({ detail }: { detail: ShiftDetail }) {
  if (detail.inputSource === 'counters') {
    return (
      <p className="text-[11px] text-zinc-400">
        {detail.permission === 'denied'
          ? 'Input Monitoring is not allowed on this Mac, so typing was read from coarse system counters: a Shift jiggler still shows, a filler key (F13–F20) does not.'
          : 'Typing was read from coarse system counters until Input Monitoring took effect.'}
      </p>
    );
  }
  return null;
}

type CaptureTile = { first: ShiftDetail['captures'][number]; last: ShiftDetail['captures'][number]; count: number };

/** A capture followed by two or more unchanged ones is one picture held for that long. */
function foldRuns(captures: ShiftDetail['captures']): CaptureTile[] {
  const tiles: CaptureTile[] = [];
  let i = 0;
  while (i < captures.length) {
    let j = i + 1;
    while (j < captures.length && captures[j].unchanged === true) j++;
    if (j - i >= 3) {
      tiles.push({ first: captures[i], last: captures[j - 1], count: j - i });
      i = j;
    } else {
      tiles.push({ first: captures[i], last: captures[i], count: 1 });
      i += 1;
    }
  }
  return tiles;
}

/**
 * The screenshots, oldest first. Three or more identical captures in a row
 * fold into one tile — "14 identical captures, 10:15–13:45" — because a run
 * of the same picture is the finding, and fourteen copies of it would hide
 * everything else on the strip.
 */
function CaptureStrip({ detail, format }: { detail: ShiftDetail; format: (ms: number) => string }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-zinc-400">Screenshots</h3>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {foldRuns(detail.captures).map(tile => {
          const src = tile.first.thumbnails?.[0];
          const run = tile.count >= 3;
          return (
            <li key={tile.first.atMs} className="w-36 shrink-0">
              {src ? (
                // Screenshots are not avatars; the shift-management viewer renders them the same way.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Screenshot at ${format(tile.first.atMs)}`}
                  loading="lazy"
                  className={cn('aspect-video w-full rounded-md border object-cover', run || tile.first.unchanged ? 'border-orange-400/60' : 'border-white/[0.07]')}
                />
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-md border border-white/[0.07] text-[11px] text-zinc-400">No image</div>
              )}
              <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">
                {run ? `${format(tile.first.atMs)}–${format(tile.last.atMs)}` : format(tile.first.atMs)}
                {!run && tile.first.activityPercent !== null && ` · ${tile.first.activityPercent}% active`}
              </p>
              {run ? (
                <p className="text-[11px] text-orange-400">{tile.count} identical captures</p>
              ) : (
                tile.first.unchanged && <p className="text-[11px] text-orange-400">Same as the one before</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
