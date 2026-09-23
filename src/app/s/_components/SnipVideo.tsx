'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { SNIP_PLAYBACK_RATES, formatSnipDuration } from '@/lib/snips';

/**
 * The shared recording, with the player built around it.
 *
 * The `<video>` itself is still a plain element pointed at a 302 to Cloud
 * Storage, for the same reason [`SnipImage`](./SnipImage.tsx) is a plain
 * `<img>`: the megabytes travel bucket → recipient and touch nothing of ours
 * (rule 9i). There is no `next/video` and nothing here streams through a
 * function of ours.
 *
 * ## Why the controls are no longer the browser's
 *
 * They were, deliberately, and the reason they stopped being is a property of
 * the *file* rather than a change of taste.
 *
 * **A `MediaRecorder` WebM has no duration in its container.** The recorder
 * writes the EBML header before it knows how long the take will be and never
 * goes back to patch it, so `Segment > Info > Duration` is simply absent. A
 * browser reads that as an open-ended stream and renders exactly what it
 * renders for a live broadcast: no end time, a scrub bar with nowhere to scrub
 * to, and — the part people actually report — no way to jump back ten seconds
 * to the thing they just missed. Native controls give us no lever on any of
 * that, because the browser is not wrong about what it was handed.
 *
 * Two things fix it, and both are here:
 *
 *  1. **We already know the duration.** The recorder's own wall clock is stored
 *     on the row (`durationMs`), so the player is seeded with the real length
 *     before a byte of media arrives. The timeline is correct on first paint,
 *     even on a metadata request that has not landed.
 *  2. **The browser is made to resolve it too** (`resolveDuration` below), by
 *     seeking past the end once. That is what restores *seeking* — a duration
 *     we merely display would give the bar an end without making it reachable.
 *
 * Once we own the controls, playback speed becomes a control rather than an
 * item buried in a context menu that not every browser offers — which is the
 * other thing recipients of a ten-minute screen recording want.
 *
 * **The accessibility that the UA sheet gave for free is re-paid explicitly**,
 * because that was the real cost of leaving it: every control is a real button
 * with a label, the scrubber and the volume are Radix sliders (arrow keys,
 * Home/End, `aria-valuetext`), and the surface itself takes the usual player
 * keys — space/k, arrows, m, f.
 *
 * `preload="metadata"` rather than `auto`: the poster already shows what the
 * recording is, so fetching the whole file for a visitor who may not press play
 * is bytes nobody asked for.
 *
 * **Not autoplaying**, and not muted to make autoplay legal. A recording can
 * carry the sender's system audio, and a link that starts making noise the
 * moment it opens is a link people stop opening at their desks.
 *
 * **Still no download button.** It would be an anchor to the video route, whose
 * 302 target is a signed Storage URL — see the note in `SnipImage`. A recipient
 * who needs the file can still save it from the element's own menu, which
 * follows the redirect without ever showing where it went.
 */
export function SnipVideo({
  src,
  poster,
  width,
  height,
  durationMs,
}: {
  src: string;
  /** The poster frame, or null when its upload failed. */
  poster: string | null;
  width: number;
  height: number;
  /**
   * The recorder's own measurement, off the row.
   *
   * **This is the authority until the browser produces something better**, and
   * for a `MediaRecorder` WebM it frequently never does. Null for a recording
   * old enough to predate the field.
   */
  durationMs: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Seeded from the row, so the timeline reads correctly before any media
  // arrives — and stays correct for a file whose container never states it.
  const [duration, setDuration] = useState(() =>
    durationMs != null && durationMs > 0 ? durationMs / 1000 : 0,
  );
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  // While the user drags, the bar follows the thumb and the media does not —
  // seeking per pointer-move would be a range request (and a redirect
  // invocation) per pixel. The commit is where the seek happens.
  const [scrub, setScrub] = useState<number | null>(null);

  /**
   * True while the duration-resolution seek is in flight.
   *
   * The seek below parks the playhead at the end of the stream to make the
   * browser admit how long it is, and `timeupdate` fires from there before
   * `durationchange` puts it back. Without this the scrub bar visibly jumps to
   * the end and the elapsed label reads the full duration for a moment — on a
   * slow connection, for longer than a moment. The playhead genuinely is at the
   * end during that window; what is wrong is *showing* it, so this suppresses
   * the reporting rather than the seek.
   */
  const resolvingRef = useRef(false);
  /** The seek is a once-per-element trick, not a retry loop. */
  const resolvedRef = useRef(false);

  /**
   * Make the browser work out how long the recording is.
   *
   * A `MediaRecorder` WebM reports `duration === Infinity`, and a media element
   * will not seek inside a stream it believes is open-ended. Seeking *past* the
   * end forces it to walk to the last cluster, at which point it knows the real
   * length, fires `durationchange`, and becomes seekable. We then put the
   * playhead back where it was.
   *
   * It costs one extra range request on open. That is the price of a scrub bar
   * that works, and it is paid once.
   */
  const resolveDuration = useCallback((video: HTMLVideoElement) => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
      return;
    }
    if (video.duration !== Infinity) return;
    // Once per element. `loadedmetadata` and the `readyState` catch-up below can
    // both reach here, and a second pass would attach a second `durationchange`
    // listener and re-seek an element that is already being walked to its end.
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const settle = () => {
      video.removeEventListener('durationchange', restore);
      resolvingRef.current = false;
      // Whatever the element says now is the truth; take it in one go rather
      // than leaving the bar on the value it held during the seek.
      setCurrentTime(video.currentTime);
    };
    const restore = () => {
      if (!Number.isFinite(video.duration)) return;
      setDuration(video.duration);
      try {
        video.currentTime = 0;
      } catch {
        // A browser that refuses the seek back leaves the playhead at the end;
        // pressing play restarts it, which is survivable. Throwing here would
        // take the player down over a cosmetic failure.
      }
      settle();
    };
    video.addEventListener('durationchange', restore);
    resolvingRef.current = true;
    try {
      // Deliberately absurd. Any finite guess could be short of the real end on
      // a long take, which would resolve the duration to the guess.
      video.currentTime = 1e101;
    } catch {
      settle();
    }
    // A stream with no seekable range never fires `durationchange`, and the
    // latch would then suppress the timeline for the life of the page. Release
    // it either way: an unresolved duration is a player that still plays.
    window.setTimeout(() => {
      if (resolvingRef.current) settle();
    }, 3000);
  }, []);

  // One subscription for the element's whole state. Attached by effect rather
  // than as JSX props so the duration resolution above can add and remove its
  // own listener on the same element without fighting React over it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => resolveDuration(video);
    const onDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const onTime = () => {
      if (resolvingRef.current) return;
      // The label is rendered to whole seconds and the bar is a few hundred
      // pixels wide, so anything under a fifth of a second is a re-render of
      // the slider and the speed menu that changes not one painted pixel.
      setCurrentTime(previous =>
        Math.abs(previous - video.currentTime) < 0.2 ? previous : video.currentTime,
      );
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onVolume = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const onRate = () => setRate(video.playbackRate);
    const onEnded = () => setPlaying(false);
    const onError = () => setFailed(true);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    // The element may already have metadata by the time this runs.
    if (video.readyState >= 1) onLoaded();

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [resolveDuration]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(seconds, duration || seconds));
    try {
      video.currentTime = target;
      setCurrentTime(target);
    } catch {
      // An unresolved duration can still refuse a seek. The bar snaps back on
      // the next `timeupdate`, which is the honest outcome.
    }
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) void document.exitFullscreen().catch(() => {});
    else void shell.requestFullscreen().catch(() => {});
  }, []);

  /**
   * The keys every player has, on the surface rather than on the element.
   *
   * `<video>` without `controls` is not focusable, so the UA's own key handling
   * is gone with the chrome — this is the half of that bargain that has to be
   * paid back. The shell carries `tabIndex`, and a key pressed while a button
   * inside it has focus is left to the button (Space on a focused button is
   * that button's activation, not a play toggle).
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const video = videoRef.current;
      if (!video) return;
      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekTo(video.currentTime + 5);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekTo(video.currentTime - 5);
          break;
        case 'm':
          event.preventDefault();
          video.muted = !video.muted;
          break;
        case 'f':
          event.preventDefault();
          toggleFullscreen();
          break;
        default:
      }
    },
    [seekTo, toggleFullscreen, togglePlay],
  );

  if (failed) {
    // One quiet line, no box of its own — DESIGN.md §5. The likeliest cause is
    // the snip being deleted between the page rendering and the media loading,
    // and "it is gone" is the whole of what a recipient can act on.
    return <p className="text-sm text-zinc-400">This recording is no longer available.</p>;
  }

  // The bar follows the thumb while dragging and the playhead otherwise. Both
  // are clamped to a duration that may still be 0 on the first frame.
  const raw = scrub ?? currentTime;
  const max = duration > 0 ? duration : Math.max(Number.isFinite(raw) ? raw : 0, 1);
  // Clamped on both ends before anything reads it. An unclamped value reached
  // `formatSnipDuration`, which divides and floors — so a stray non-finite
  // currentTime would have rendered scientific notation into the timeline.
  const shown = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), max) : 0;
  const elapsedLabel = formatSnipDuration(shown * 1000);
  // A recording whose length is not known yet says so rather than printing a
  // confident `0:00`, which is the exact wrongness this component exists to fix.
  const durationLabel = duration > 0 ? formatSnipDuration(duration * 1000) : '–:––';

  return (
    <div
      ref={shellRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="group"
      aria-label="Shared recording player"
      className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-black focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        preload="metadata"
        playsInline
        onClick={togglePlay}
        // The recording's real pixel dimensions, so the box reserves its
        // correct shape before a byte lands and the attribution line below
        // never jumps. They come off the row, not off the file.
        width={width > 0 ? width : undefined}
        height={height > 0 ? height : undefined}
        className="h-auto w-full cursor-pointer bg-black"
      >
        {/* Reached only by a browser with no WebM decoder at all. Saying so is
            better than an empty black box, and the link is still good — it can
            be opened somewhere else. */}
        Your browser cannot play this recording.
      </video>

      {/* The big centred affordance, and only before the first play: once the
          recipient has started it, the bar below is where they look. It is
          `aria-hidden` and click-through — the element underneath already
          toggles playback, and a second focusable "play" would be the same
          control twice in the tab order. */}
      {!playing && !waiting && currentTime === 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/20">
            <Play className="size-6 translate-x-[2px] fill-white text-white" />
          </span>
        </span>
      )}

      {/* The control bar. Always present rather than hover-revealed: a bar that
          appears on hover is a bar a keyboard user and a touch user cannot find,
          and this is the only chrome the page has. Its own scrim keeps it legible
          over a frame of unknown brightness. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2 pb-1 pt-6 sm:px-3">
        <Slider
          value={[shown]}
          min={0}
          max={max}
          step={0.1}
          // On the THUMB, not the root: Radix puts `role="slider"` there, so a
          // label spread onto the root never reaches what is announced. Screen
          // readers otherwise read "0.4 of 132", which is a number of nothing —
          // the unit is the point of this control.
          thumbProps={{ 'aria-label': 'Seek', 'aria-valuetext': `${elapsedLabel} of ${durationLabel}` }}
          onValueChange={([value]) => setScrub(value)}
          onValueCommit={([value]) => {
            setScrub(null);
            seekTo(value);
          }}
          // `py-2` is the hit area, not the look: Radix takes pointer events on
          // the Root, and the Root's height is the 16px thumb — so the strip a
          // thumb has to land on was 16px tall, under WCAG 2.2 SC 2.5.8's 24px
          // minimum. The padding is transparent, so the bar looks identical and
          // the target is 32px. Done here rather than in `slider.tsx` because
          // this is a player's need, not the whole app's.
          className="cursor-pointer py-2"
        />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-zinc-200 hover:bg-white/10 hover:text-white"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={togglePlay}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-zinc-200 hover:bg-white/10 hover:text-white"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              const video = videoRef.current;
              if (video) video.muted = !video.muted;
            }}
          >
            {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>

          {/* Hidden below `sm` rather than shrunk: at phone width the device's
              own volume keys are the control people reach for, and a 40px
              slider between two buttons is a mis-tap waiting to happen. */}
          <Slider
            value={[muted ? 0 : volume]}
            min={0}
            max={1}
            step={0.05}
            thumbProps={{
              'aria-label': 'Volume',
              'aria-valuetext': `${Math.round((muted ? 0 : volume) * 100)}%`,
            }}
            onValueChange={([value]) => {
              const video = videoRef.current;
              if (!video) return;
              video.volume = value;
              // Moving the slider off zero is an unmute by intent; leaving it
              // muted would make the control appear not to work.
              video.muted = value === 0;
            }}
            className="hidden w-20 cursor-pointer py-2 sm:flex"
          />

          <span className="ml-1 shrink-0 text-[11px] tabular-nums text-zinc-300">
            {elapsedLabel} / {durationLabel}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {/* Speed is a first-class control, not a browser context-menu item.
                A screen recording is the case where it earns that: a recipient
                skimming a ten-minute demo, or stepping through the two seconds
                where something went wrong. The trigger states the current rate
                so the setting is legible without opening the menu. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1 px-2.5 text-zinc-200 hover:bg-white/10 hover:text-white"
                  aria-label={`Playback speed, currently ${rate}×`}
                >
                  <Gauge className="size-4" />
                  <span className="text-[11px] tabular-nums">{rate}×</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-28">
                {SNIP_PLAYBACK_RATES.map(option => (
                  <DropdownMenuItem
                    key={option}
                    // `aria-current` rather than a tick glyph: the menu is a
                    // list of values, and the one in force is a state rather
                    // than a decoration.
                    aria-current={option === rate ? 'true' : undefined}
                    className={option === rate ? 'font-semibold text-white' : undefined}
                    onSelect={() => {
                      const video = videoRef.current;
                      if (video) video.playbackRate = option;
                    }}
                  >
                    {option === 1 ? 'Normal' : `${option}×`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="size-11 text-zinc-200 hover:bg-white/10 hover:text-white"
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
