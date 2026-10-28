'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pause, Play, Radio, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { trainingAdmin } from '@/hooks/useTrainingAdmin';
import { formatSnipBytes } from '@/lib/snips';
import { RECORDING_STALE_MS, SEGMENT_MS, recordedSpans, recordingGaps } from '@/lib/training/recording';
import type { AdminRecordingSegment, AdminRecordingView } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { formatClockTime, formatDuration, formatWhen } from './zonedTime';

/** How often the live view asks for new segments — one segment's length. */
const POLL_MS = SEGMENT_MS;
/** Keep polling this long after the part ends: the last segment lands inside the upload grace. */
const TAIL_MS = 60_000;

interface RecordingPlayerProps {
  sessionId: string;
  emailHash: string;
  partId: string;
  timezone: string;
  /** The part's title, for the delete confirmation. */
  partTitle: string;
}

/**
 * One attempt's screen recording: live while the part runs (about one segment
 * behind), a replay afterwards.
 *
 * The recording is a run of ~10 s files. Two `<video>` elements take turns —
 * the visible one plays segment N while the hidden one has N+1 loaded — so the
 * hand-over between files does not flash. While live, it asks only for the
 * segments after the last one it holds, every ten seconds, and only while the
 * window is visible (rule 9i). Mounted only while its dialog or panel is open.
 */
export default function RecordingPlayer({ sessionId, emailHash, partId, timezone, partTitle }: RecordingPlayerProps) {
  const path = `sessions/${sessionId}/participants/${emailHash}/recording?part=${encodeURIComponent(partId)}`;
  const [view, setView] = useState<AdminRecordingView | null>(null);
  const [segments, setSegments] = useState<AdminRecordingSegment[]>([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [offsetMs, setOffsetMs] = useState(0);
  /** Played to the newest segment while live: the next one to arrive plays at once. */
  const [waiting, setWaiting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null]);

  useEffect(() => {
    let cancelled = false;
    trainingAdmin<AdminRecordingView>(path)
      .then((res) => {
        if (cancelled) return;
        setView(res);
        setSegments(res.segments);
        // Live opens on the newest segment; a replay from the beginning.
        setIndex(res.live ? Math.max(0, res.segments.length - 1) : 0);
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the recording');
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  const poll = useEffectEvent(async () => {
    if (!view?.recorded || document.visibilityState !== 'visible') return;
    const ended = view.endsAtMs !== null && view.nowMs - view.endsAtMs > TAIL_MS;
    if (!view.live && ended) return;
    const last = segments.at(-1)?.seq;
    const res = await trainingAdmin<AdminRecordingView>(last === undefined ? path : `${path}&after=${last}`);
    // An `after` read carries no check still; keep the one from the first read.
    setView((prev) => ({ ...res, check: prev?.check }));
    if (res.segments.length === 0) return;
    setSegments((prev) => {
      const seen = new Set(prev.map((s) => s.seq));
      return [...prev, ...res.segments.filter((s) => !seen.has(s.seq))];
    });
    if (waiting) {
      setWaiting(false);
      setIndex(segments.length);
    }
  });
  useEffect(() => {
    const id = window.setInterval(() => void poll().catch(() => {}), POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // The visible element plays; the other holds the next segment, paused at its start.
  useEffect(() => {
    const front = videos.current[index % 2];
    videos.current[(index + 1) % 2]?.pause();
    if (!front) return;
    front.playbackRate = rate;
    if (playing && !waiting) void front.play().catch(() => {});
    else front.pause();
  }, [index, playing, rate, waiting, segments.length]);

  function advance() {
    if (index + 1 < segments.length) {
      setOffsetMs(0);
      setIndex(index + 1);
    } else if (view?.live) {
      setWaiting(true);
    } else {
      setPlaying(false);
    }
  }

  function seek(next: number) {
    setWaiting(false);
    setOffsetMs(0);
    setIndex(Math.max(0, Math.min(segments.length - 1, next)));
  }

  async function remove() {
    setDeleting(true);
    try {
      await trainingAdmin(path, 'DELETE');
      toast.success('Recording deleted');
      setConfirmDelete(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the recording');
    } finally {
      setDeleting(false);
    }
  }

  // Walks every segment, so it is worked out when the recording changes — not on
  // each `timeupdate` (about four renders a second while playing).
  const timeline = useMemo(() => {
    if (!view) return null;
    const rangeStart = view.startedAtMs ?? segments[0]?.endedAtMs ?? 0;
    const rangeEnd = Math.max(view.live ? view.nowMs : (view.endsAtMs ?? 0), segments.at(-1)?.endedAtMs ?? 0);
    const span = Math.max(1, rangeEnd - rangeStart);
    return {
      totalBytes: segments.reduce((n, s) => n + s.bytes, 0),
      gaps: (view.startedAtMs && segments.length
        ? recordingGaps(segments, view.startedAtMs, rangeEnd, view.reopenedAtMs)
        : []
      )
        // While live, the newest segment is normally a little old; it is only a gap once the server would say so.
        .filter((g) => !(view.live && g.toMs === rangeEnd && rangeEnd - g.fromMs < RECORDING_STALE_MS)),
      spans: recordedSpans(segments),
      at: (ms: number) => `${((ms - rangeStart) / span) * 100}%`,
      width: (fromMs: number, toMs: number) => `${((toMs - fromMs) / span) * 100}%`,
    };
  }, [view, segments]);

  if (error && !view) {
    return (
      <div role="alert" className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex justify-center py-8" role="status">
        <Loader2 className="activity-spinner size-5 animate-spin text-zinc-400" />
        <span className="sr-only">Loading the recording</span>
      </div>
    );
  }

  const current = segments[index];
  const atMs = current ? current.endedAtMs - SEGMENT_MS + offsetMs : null;
  const { totalBytes, gaps, spans, at, width } = timeline!;
  const check = view.check;

  let empty: string | null = null;
  if (segments.length === 0) {
    if (view.deletedAtMs) empty = `This recording was deleted ${formatWhen(view.deletedAtMs, timezone)}.`;
    else if (!view.startedAtMs) empty = 'This part has not been started.';
    else if (!view.recorded) empty = 'This attempt started before screen recording was switched on, so it has no recording.';
    else if (view.live) empty = 'Waiting for the first part of the recording to arrive…';
    else empty = 'No recording arrived for this attempt.';
  }

  return (
    <section aria-label="Screen recording" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Screen recording</h3>
          {view.live && (
            <Badge variant="outline" className="gap-1.5 border-red-400/40 bg-red-500/10 text-red-300">
              <span className="size-1.5 rounded-full bg-red-400" aria-hidden />
              Live
            </Badge>
          )}
        </div>
        {segments.length > 0 && (
          <p className="text-[11px] text-zinc-400 tabular-nums">
            {formatDuration(segments.length * SEGMENT_MS)} · {formatSnipBytes(totalBytes)}
            {view.live ? ' · about 10–20 seconds behind' : ''}
          </p>
        )}
      </div>

      {empty ? (
        <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm text-zinc-400" role="status">
          {empty}
        </p>
      ) : (
        <>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/[0.07] bg-black">
            {[0, 1].map((slot) => {
              const front = index % 2 === slot;
              const seg = segments[front ? index : index + 1];
              return (
                <video
                  key={slot}
                  ref={(el) => {
                    videos.current[slot] = el;
                  }}
                  src={seg?.url}
                  preload="auto"
                  muted
                  playsInline
                  aria-hidden={!front}
                  onEnded={front ? advance : undefined}
                  onError={front ? advance : undefined}
                  onTimeUpdate={front ? (e) => setOffsetMs(e.currentTarget.currentTime * 1000) : undefined}
                  className={cn('absolute inset-0 size-full object-contain', front ? 'visible' : 'invisible')}
                />
              );
            })}
            {waiting && (
              <p className="absolute right-3 bottom-3 rounded-md bg-black/70 px-2 py-1 text-xs text-zinc-200" role="status">
                Waiting for the next few seconds…
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {/* Where there is recording and where there is none, across the whole attempt. */}
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              {spans.map((s) => (
                <span key={`r${s.fromMs}`} className="absolute inset-y-0 bg-emerald-500/50" style={{ left: at(s.fromMs), width: width(s.fromMs, s.toMs) }} />
              ))}
              {gaps.map((g) => (
                <span key={`g${g.fromMs}`} className="absolute inset-y-0 bg-red-500/70" style={{ left: at(g.fromMs), width: width(g.fromMs, g.toMs) }} />
              ))}
            </div>
            <Slider
              value={[index]}
              min={0}
              max={Math.max(0, segments.length - 1)}
              step={1}
              onValueChange={([v]) => seek(v)}
              thumbProps={{
                'aria-label': 'Position in the recording',
                'aria-valuetext': atMs ? `About ${formatClockTime(atMs, timezone)}` : undefined,
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={String(rate)}
              onValueChange={(v) => v && setRate(Number(v))}
              aria-label="Playback speed"
            >
              {[1, 2, 4].map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="px-2.5 text-xs tabular-nums">
                  {r}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {view.live && index < segments.length - 1 && (
              <Button variant="outline" size="sm" onClick={() => seek(segments.length - 1)}>
                <Radio className="size-4" />
                Jump to live
              </Button>
            )}
            {atMs && <span className="text-xs text-zinc-400 tabular-nums">about {formatClockTime(atMs, timezone)}</span>}
          </div>

          {gaps.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-zinc-400">
              {gaps.map((g) => (
                <li key={g.fromMs} className="tabular-nums">
                  <span className="text-red-300">No recording</span> for {formatDuration(g.toMs - g.fromMs)} from about{' '}
                  {formatClockTime(g.fromMs, timezone)} — the screen was not shared, or the upload was not getting through.
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {check ? (
          <a href={check.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={check.url} alt="Screen check" className="h-12 w-auto rounded-md border border-white/[0.07]" />
            <span className="text-[11px] text-zinc-400">Screen check {formatClockTime(check.atMs, timezone)}</span>
          </a>
        ) : (
          <span />
        )}
        {(segments.length > 0 || check) && !view.live && (
          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-red-400" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" />
            Delete recording
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The screen recording of {partTitle} is deleted for good. The work they uploaded is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {deleting && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Delete recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
