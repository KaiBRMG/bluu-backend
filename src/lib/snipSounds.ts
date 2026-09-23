/**
 * The Snipping Tool's two sound effects.
 *
 * **Both are played by the renderer, not by main**, for the plain reason that
 * the main process has no audio output — Electron gives it no `Audio`, and the
 * alternatives (spawning `afplay`/`powershell`) are a process per shutter. The
 * app window is the one surface that can make a noise while the user is looking
 * at something else, which is exactly the case both of these exist for.
 *
 * ## Timing is the whole point, and it is why the events come from main
 *
 * The shutter has to land at the moment the screen is photographed, not when
 * the PNG finishes encoding — a large capture spends a hundred milliseconds in
 * `toPNG()` plus base64, and a shutter that fires after it reads as lag rather
 * than as confirmation. So main emits `snip:shutter` the instant
 * `desktopCapturer` returns, and `snip:captured` (the bytes) follows later.
 *
 * The recording tone has the opposite constraint: it must land *before*
 * `MediaRecorder` starts, because on Windows a recording can be taking the
 * desktop's own audio via loopback and a cue played after the start would be
 * the first thing on the soundtrack. Main emits `snip:rec-started` before it
 * even opens the recorder window, which is several hundred milliseconds of
 * window creation and `getDisplayMedia` ahead of the first frame.
 *
 * ## Failure is silent, deliberately
 *
 * Autoplay policy, a muted device, a missing file: none of them are worth a
 * toast over a capture that is working. `play()` rejects and we swallow it.
 */

/** Fired at the shutter — the moment the screen is photographed. */
export const SNIP_CAPTURE_SOUND = '/image_capture.wav';
/** Fired as a recording is starting, before the first frame is encoded. */
export const SNIP_RECORDING_SOUND = '/recording_start.wav';

/**
 * A cached `Audio` per asset.
 *
 * A fresh `new Audio(src)` per shutter re-fetches the file on a cold cache,
 * which is the one thing that would put network latency in front of a sound
 * whose entire job is to be immediate. `currentTime = 0` restarts the cached
 * one instead, so a second capture a moment later is instant.
 */
const cache = new Map<string, HTMLAudioElement>();

export function playSnipSound(src: string): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  try {
    let audio = cache.get(src);
    if (!audio) {
      audio = new Audio(src);
      audio.preload = 'auto';
      cache.set(src, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // A locked-down engine, or an asset that will not decode. Neither is worth
    // interrupting a capture over.
  }
}
