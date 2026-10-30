'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Maximize, Minimize, Pause, Play, Radio, Trash2 } from 'lucide-react';
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
/** Once playback has caught up with the newest segment, ask far more often so the stall is short. */
const CATCH_UP_POLL_MS = 2_000;
/**
 * Live plays one segment behind the newest, so the next file is always already here when the
 * current one ends — playing the very newest segment means running dry within ten seconds and
 * stalling until the next poll, which is what made live playback stutter.
 */
const LIVE_BUFFER = 1;
/** Keep polling this long after the test ends: the last segment lands inside the upload grace. */
const TAIL_MS = 60_000;

interface RecordingPlayerProps {
  moduleId: string;
  emailHash: string;
  testId: string;
  timezone: string;
  /** The test's title, for the delete confirmation. */
  testTitle: string;
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
export default function RecordingPlayer({ moduleId, emailHash, testId, timezone, testTitle }: RecordingPlayerProps) {
  const path = `modules/${moduleId}/participants/${emailHash}/recording?test=${encodeURIComponent(testId)}`;
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
  /** Polls are failing (offline, server down, signed out): say so instead of an endless "waiting". */
  const [connection, setConnection] = useState<'ok' | 'retrying'>('ok');
  /** Clips that would not play even with freshly signed URLs — skipped, and counted out loud. */
  const [skipped, setSkipped] = useState(0);
  /** What screen readers hear when the playback state changes (live → ended, lost connection, …). */
  const [announce, setAnnounce] = useState('');
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
        // Live opens one segment behind the newest (see LIVE_BUFFER); a replay from the beginning.
        setIndex(res.live ? Math.max(0, res.segments.length - 1 - LIVE_BUFFER) : 0);
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the recording');
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  const polling = useRef(false);
  const poll = useEffectEvent(async () => {
    if (!view?.recorded || document.visibilityState !== 'visible' || polling.current) return;
    const ended = view.endsAtMs !== null && view.nowMs - view.endsAtMs > TAIL_MS;
    if (!view.live && ended) return;
    const last = segments.at(-1)?.seq;
    polling.current = true;
    let res: AdminRecordingView;
    try {
      res = await trainingAdmin<AdminRecordingView>(last === undefined ? path : `${path}&after=${last}`);
    } catch {
      if (connection === 'ok') {
        setConnection('retrying');
        setAnnounce('Lost the connection to the recording. Retrying.');
      }
      return;
    } finally {
      polling.current = false;
    }
    if (connection !== 'ok') {
      setConnection('ok');
      setAnnounce('Reconnected.');
    }
    if (view.live && !res.live) setAnnounce('The test has ended. This is now a replay.');
    // An `after` read carries no check still; keep the one from the first read.
    setView((prev) => ({ ...res, check: prev?.check }));
    if (res.segments.length === 0) {
      // Caught up with a test that has now ended: nothing more is coming, so stop rather than wait forever.
      if (waiting && !res.live) {
        setWaiting(false);
        setPlaying(false);
      }
      return;
    }
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
    const every = waiting || connection === 'retrying' ? CATCH_UP_POLL_MS : POLL_MS;
    const id = window.setInterval(() => void poll(), every);
    // Back in view after a while: catch up now rather than at the next beat.
    const onVisible = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [waiting, connection]);

  // The visible element plays; the other holds the next segment, paused at its start.
  useEffect(() => {
    const front = videos.current[index % 2];
    videos.current[(index + 1) % 2]?.pause();
    if (!front) return;
    front.playbackRate = rate;
    if (playing && !waiting) void front.play().catch((err: unknown) => {
      // A play() interrupted by the next src swap is normal; anything else means playback did not start.
      if ((err as { name?: string })?.name !== 'AbortError') setPlaying(false);
    });
    else front.pause();
  }, [index, playing, rate, waiting, segments.length]);

  /** Clips already re-signed once: a second failure on the same one is a bad file, not an old URL. */
  const resigned = useRef(new Set<number>());

  /**
   * A clip failed to load. The usual cause is a signed URL that expired because the panel was left
   * open for hours, so fetch the list again (fresh URLs) and retry the same clip; only a clip that
   * still fails is skipped — and counted, never silently.
   */
  async function recover() {
    const seg = segments[index];
    if (!seg) return;
    if (resigned.current.has(seg.seq)) {
      setSkipped((n) => n + 1);
      advance();
      return;
    }
    resigned.current.add(seg.seq);
    try {
      const res = await trainingAdmin<AdminRecordingView>(path);
      setSegments(res.segments);
      setView((prev) => ({ ...res, check: res.check ?? prev?.check }));
    } catch {
      setSkipped((n) => n + 1);
      advance();
    }
  }

  function advance() {
    if (index + 1 < segments.length) {
      // The next file is already loaded in the hidden element: start it now, before React re-renders,
      // so the hand-over between ten-second files does not stall.
      const back = videos.current[(index + 1) % 2];
      if (back && playing) {
        back.playbackRate = rate;
        void back.play().catch(() => {});
      }
      setOffsetMs(0);
      setIndex(index + 1);
    } else if (view?.live) {
      if (rate !== 1) {
        setRate(1);
        setAnnounce('Caught up with live. Playing at normal speed.');
      }
      setWaiting(true);
    } else {
      setPlaying(false);
    }
  }

  /** Where to start the next front element, once it has loaded — a seek inside a segment. */
  const pendingOffset = useRef<number | null>(null);

  function seek(next: number, withinMs = 0) {
    setWaiting(false);
    const target = Math.max(0, Math.min(segments.length - 1, next));
    const front = videos.current[target % 2];
    if (target === index && front) {
      front.currentTime = withinMs / 1000;
    } else {
      pendingOffset.current = withinMs;
    }
    setOffsetMs(withinMs);
    setIndex(target);
  }

  /** Seek to a position on the whole recording's timeline (ms from its start). */
  function seekTo(ms: number) {
    const at = Math.max(0, ms);
    seek(Math.floor(at / SEGMENT_MS), at % SEGMENT_MS);
  }

  // Fullscreen covers the video AND its controls, so the controls are still there in fullscreen.
  const stage = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Not every browser can put an element in full screen (iOS Safari cannot): offer it only where it works.
  const [canFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenEnabled);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stage.current && !!stage.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  /** Keyboard, on the picture: Space/K play-pause, ←/→ ten seconds, F full screen. Controls keep their own keys. */
  function onStageKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') setPlaying((p) => !p);
    else if (key === 'arrowright') seekTo(index * SEGMENT_MS + offsetMs + SEGMENT_MS);
    else if (key === 'arrowleft') seekTo(index * SEGMENT_MS + offsetMs - SEGMENT_MS);
    else if (key === 'f' && canFullscreen) toggleFullscreen();
    else return;
    e.preventDefault();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stage.current?.requestFullscreen().catch(() => {});
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
  /** Position and length on the recording's own timeline: segments laid end to end, ~10 s each. */
  const totalMs = segments.length * SEGMENT_MS;
  const positionMs = Math.min(totalMs, index * SEGMENT_MS + Math.min(offsetMs, SEGMENT_MS));
  /** Watching within the live buffer of the newest segment — i.e. as close to live as playback gets. */
  const atLiveEdge = view.live && segments.length - 1 - index <= LIVE_BUFFER;
  const clock = (ms: number) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(t / 3600);
    const mm = String(Math.floor((t % 3600) / 60)).padStart(h ? 2 : 1, '0');
    const ss = String(t % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  let empty: string | null = null;
  if (segments.length === 0) {
    if (view.deletedAtMs) empty = `This recording was deleted ${formatWhen(view.deletedAtMs, timezone)}.`;
    else if (!view.startedAtMs) empty = 'This test has not been started.';
    else if (!view.recorded) empty = 'This attempt started before screen recording was switched on, so it has no recording.';
    else if (view.live) empty = 'Waiting for the first part of the recording to arrive…';
    else empty = 'No recording arrived for this attempt.';
  }

  return (
    <section aria-label="Screen recording" className="flex flex-col gap-3">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Screen recording</h3>
          {view.live ? (
            <Badge variant="outline" className="gap-1.5 border-red-400/50 bg-red-500/15 font-semibold tracking-wide text-red-300">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full rounded-full bg-red-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-red-400" />
              </span>
              LIVE — test in progress
            </Badge>
          ) : (
            segments.length > 0 && (
              <Badge variant="outline" className="border-white/10 bg-white/[0.04] text-zinc-300">
                Replay
              </Badge>
            )
          )}
        </div>
        {segments.length > 0 && (
          <p className="text-[11px] text-zinc-400 tabular-nums">
            {formatDuration(totalMs)} · {formatSnipBytes(totalBytes)}
            {view.live ? ' · about 10–20 seconds behind' : ''}
          </p>
        )}
      </div>

      {empty ? (
        <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm text-zinc-400" role="status">
          {empty}
        </p>
      ) : (
        <div
          ref={stage}
          className={cn('flex flex-col gap-2', fullscreen && 'h-full justify-center bg-black p-4')}
        >
          <div
            tabIndex={0}
            role="group"
            aria-label="Recording. Space to play or pause, left and right arrows to move ten seconds, F for full screen."
            onKeyDown={onStageKey}
            className={cn(
              'relative w-full overflow-hidden rounded-xl border border-white/[0.07] bg-black outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60',
              fullscreen ? 'min-h-0 flex-1' : 'aspect-video',
            )}
          >
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
                  onClick={front ? () => setPlaying((p) => !p) : undefined}
                  onLoadedData={
                    front
                      ? (e) => {
                          // A seek into the middle of a segment lands once that file has loaded.
                          if (pendingOffset.current !== null) {
                            e.currentTarget.currentTime = pendingOffset.current / 1000;
                            pendingOffset.current = null;
                          }
                        }
                      : undefined
                  }
                  onEnded={front ? advance : undefined}
                  onError={front ? () => void recover() : undefined}
                  onTimeUpdate={front ? (e) => setOffsetMs(e.currentTarget.currentTime * 1000) : undefined}
                  className={cn('absolute inset-0 size-full cursor-pointer object-contain', front ? 'visible' : 'invisible')}
                />
              );
            })}
            {/* On the picture, so it is unmissable — and in fullscreen too. */}
            {view.live && (
              <span
                className={cn(
                  'pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tracking-wide',
                  atLiveEdge ? 'bg-red-600 text-white' : 'bg-black/75 text-zinc-200',
                )}
              >
                <span className={cn('size-1.5 rounded-full', atLiveEdge ? 'bg-white' : 'bg-red-400')} aria-hidden />
                {atLiveEdge ? 'LIVE' : 'Behind live'}
              </span>
            )}
            {connection === 'retrying' ? (
              <p className="absolute right-3 bottom-3 max-w-[calc(100%-1.5rem)] rounded-md bg-black/80 px-2 py-1 text-xs text-orange-200">
                Can’t reach the server — retrying every few seconds. Check your connection.
              </p>
            ) : (
              waiting && (
                <p className="absolute right-3 bottom-3 rounded-md bg-black/70 px-2 py-1 text-xs text-zinc-200">
                  Waiting for the next few seconds…
                </p>
              )
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
              value={[positionMs]}
              min={0}
              max={Math.max(1, totalMs)}
              step={1000}
              onValueChange={([v]) => seekTo(v)}
              thumbProps={{
                'aria-label': 'Position in the recording',
                'aria-valuetext': `${clock(positionMs)} of ${clock(totalMs)}${atMs ? `, about ${formatClockTime(atMs, timezone)}` : ''}`,
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <span className="text-xs text-zinc-300 tabular-nums">
              {clock(positionMs)} / {clock(totalMs)}
            </span>
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
            {view.live && !atLiveEdge && (
              <Button variant="outline" size="sm" onClick={() => seek(segments.length - 1 - LIVE_BUFFER)}>
                <Radio className="size-4" />
                Jump to live
              </Button>
            )}
            {atMs && <span className="text-xs text-zinc-400 tabular-nums">about {formatClockTime(atMs, timezone)}</span>}
            {canFullscreen && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              >
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </Button>
            )}
          </div>

          {skipped > 0 && (
            <p className="text-xs text-orange-300">
              {skipped === 1 ? '1 clip' : `${skipped} clips`} of about ten seconds could not be played and {skipped === 1 ? 'was' : 'were'} skipped.
            </p>
          )}

          {gaps.length > 0 && !fullscreen && (
            <ul className="flex flex-col gap-1 text-xs text-zinc-400">
              {gaps.map((g) => (
                <li key={g.fromMs} className="tabular-nums">
                  <span className="text-red-300">No recording</span> for {formatDuration(g.toMs - g.fromMs)} from about{' '}
                  {formatClockTime(g.fromMs, timezone)} — the screen was not shared, or the upload was not getting through.
                </li>
              ))}
            </ul>
          )}
        </div>
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
              The screen recording of {testTitle} is deleted for good. The work they uploaded is kept.
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
