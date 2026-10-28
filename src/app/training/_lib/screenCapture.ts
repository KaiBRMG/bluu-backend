'use client';

import {
  CAPTURE_BITS_PER_SECOND,
  CAPTURE_FRAME_RATE,
  CAPTURE_MAX_HEIGHT,
  CAPTURE_MAX_WIDTH,
  MAX_CHECK_BYTES,
  SEGMENT_MS,
  type RecordingType,
} from '@/lib/training/recording';
import { ApiError } from './api';

/**
 * The candidate's screen share and its recording. Browser-only.
 *
 * The share is `getDisplayMedia`, which needs a click every time — nothing here
 * can start one on its own, so a refresh mid-attempt always needs the candidate
 * to share again (the task room locks until they do).
 */

export type ShareProblem = 'unsupported' | 'denied' | 'not-screen' | 'blank' | 'failed';

export class ShareError extends Error {
  constructor(public problem: ShareProblem) {
    super(problem);
  }
}

export function captureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    pickRecordingType() !== null
  );
}

/** The first container this browser records, as a mime type and as the plain type the upload is signed for. */
export function pickRecordingType(): { mimeType: string; contentType: RecordingType } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: [string, RecordingType][] = [
    ['video/webm;codecs=vp9', 'video/webm'],
    ['video/webm;codecs=vp8', 'video/webm'],
    ['video/webm', 'video/webm'],
    ['video/mp4;codecs=avc1', 'video/mp4'],
    ['video/mp4', 'video/mp4'],
  ];
  for (const [mimeType, contentType] of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, contentType };
  }
  return null;
}

/**
 * Whether the track is a whole screen. `displaySurface` says so directly where
 * the browser reports it; where it does not, a capture with the screen's own
 * shape is the best available evidence (a window or a tab rarely has it). The
 * candidate also confirms the preview, and the admin sees the recording.
 */
function isWholeScreen(track: MediaStreamTrack): boolean {
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  if (settings.displaySurface) return settings.displaySurface === 'monitor';
  if (!settings.width || !settings.height) return false;
  return Math.abs(settings.width / settings.height - window.screen.width / window.screen.height) < 0.03;
}

/** One frame of the stream drawn onto a canvas no wider than `maxWidth`. */
async function grabFrame(stream: MediaStream, maxWidth: number): Promise<HTMLCanvasElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    // The first decoded frame can be empty on some browsers; wait for real dimensions and a beat.
    for (let i = 0; i < 20 && (!video.videoWidth || video.readyState < 2); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * A frame with nothing on it. A Mac whose browser lacks Screen Recording
 * permission can hand back a black stream. Judged on the full frame, by how
 * many pixels have any brightness at all — a dark-mode desktop showing this
 * page is mostly near-black too, but its text alone is far more than the
 * threshold. (A thumbnail would not do: downscaling samples, and thin white
 * text vanishes from it.)
 */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 40) lit += 1;
  }
  return lit < (data.length / 4) * 0.0005;
}

/**
 * Asks for the whole screen and proves it: a monitor (not a window or a tab),
 * and not a black frame. Anything else is stopped and refused.
 */
export async function requestScreenShare(): Promise<MediaStream> {
  if (!captureSupported()) throw new ShareError('unsupported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
        frameRate: { ideal: CAPTURE_FRAME_RATE, max: CAPTURE_FRAME_RATE * 2 },
        width: { max: CAPTURE_MAX_WIDTH },
        height: { max: CAPTURE_MAX_HEIGHT },
      },
      audio: false,
      // Chromium hints: offer screens first, hide this tab, and remove the
      // share bar's "share this tab instead", which would switch mid-test
      // without any event to catch. Unknown members are ignored elsewhere.
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      preferCurrentTab: false,
    } as DisplayMediaStreamOptions);
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new ShareError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
  }

  const stop = () => stream.getTracks().forEach((t) => t.stop());
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stop();
    throw new ShareError('failed');
  }
  if (!isWholeScreen(track)) {
    stop();
    throw new ShareError('not-screen');
  }
  let blank: boolean;
  try {
    blank = isBlank(await grabFrame(stream, 640));
  } catch {
    stop();
    throw new ShareError('failed');
  }
  if (blank) {
    stop();
    throw new ShareError('blank');
  }
  return stream;
}

/** The screen-check still: a JPEG of the share, small enough for the check's limit. */
export async function grabCheckFrame(stream: MediaStream): Promise<Blob> {
  for (const [width, quality] of [[1280, 0.7], [960, 0.6]] as const) {
    const canvas = await grabFrame(stream, width);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_CHECK_BYTES) return blob;
  }
  throw new ShareError('failed');
}

/** Most segments held while the line is down: ~10 minutes. Older ones are dropped first. */
const MAX_QUEUE = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Records a stream as a run of standalone segments and uploads each to its own
 * signed URL, one at a time so the recording never crowds out an edit upload.
 *
 * Each segment is a NEW MediaRecorder: chunks a single recorder emits after its
 * first have no header and cannot be played alone. The rotation is driven by the
 * recorder's own `timeslice` event, not a timer — a timer in a background tab
 * (the candidate is in their editing app) is throttled to once a minute.
 */
export class ScreenRecorder {
  private current: MediaRecorder | null = null;
  private queue: Blob[] = [];
  private slots: { seq: number; url: string }[] = [];
  private pumping = false;
  private stopping = false;
  /** The server stopped signing (time is up): nothing more can upload. */
  private closed = false;
  private failures = 0;
  private settled: (() => void) | null = null;

  constructor(
    private stream: MediaStream,
    private format: { mimeType: string; contentType: RecordingType },
    private fetchSlots: () => Promise<{ seq: number; url: string }[]>,
    /** True once several segment uploads in a row have failed — the server will soon refuse edit uploads. */
    private onFailing: (failing: boolean) => void,
  ) {}

  start() {
    this.next();
  }

  private next() {
    if (this.stopping || !this.stream.active) {
      this.settled?.();
      return;
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, {
        mimeType: this.format.mimeType,
        videoBitsPerSecond: CAPTURE_BITS_PER_SECOND,
      });
    } catch {
      this.onFailing(true);
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
      // The timeslice fired: close this file (its final chunk follows) and begin the next.
      if (rec.state === 'recording') rec.stop();
    };
    rec.onstop = () => {
      if (chunks.length) this.enqueue(new Blob(chunks, { type: this.format.contentType }));
      if (this.current === rec) this.current = null;
      this.next();
    };
    this.current = rec;
    rec.start(SEGMENT_MS);
  }

  private enqueue(blob: Blob) {
    if (this.closed) return;
    this.queue.push(blob);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.closed) {
        const result = await this.uploadOne(this.queue[0]);
        if (result === 'closed') {
          this.closed = true;
          this.queue = [];
        } else if (result === 'ok') {
          this.queue.shift();
          if (this.failures) this.onFailing(false);
          this.failures = 0;
        } else {
          this.failures += 1;
          if (this.failures === 3) this.onFailing(true);
          await sleep(Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5)));
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async uploadOne(blob: Blob): Promise<'ok' | 'retry' | 'closed'> {
    if (this.slots.length === 0) {
      try {
        this.slots = await this.fetchSlots();
      } catch (error) {
        // A refusal (time is up, session stopped, signed out) is final; anything else is the line.
        return error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'closed' : 'retry';
      }
    }
    const slot = this.slots[0];
    try {
      const res = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'Content-Type': this.format.contentType },
        body: blob,
      });
      if (res.ok) {
        this.slots.shift();
        return 'ok';
      }
      // An expired or rejected signature: ask for fresh ones. The skipped numbers are harmless.
      if (res.status === 400 || res.status === 403) this.slots = [];
      return 'retry';
    } catch {
      return 'retry';
    }
  }

  /**
   * Closes the current segment and gives the queue up to `drainMs` to upload.
   * Never throws; the caller releases the share afterwards.
   */
  async stop(drainMs: number): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await new Promise<void>((resolve) => {
      if (!this.current || this.current.state === 'inactive') return resolve();
      this.settled = resolve;
      this.current.stop();
    });
    const until = Date.now() + drainMs;
    while ((this.queue.length || this.pumping) && !this.closed && Date.now() < until) await sleep(250);
  }
}
