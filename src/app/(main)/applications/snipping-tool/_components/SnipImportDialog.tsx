'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MAX_SNIP_BYTES,
  MAX_SNIP_IMPORT_VIDEO_BYTES,
  MAX_SNIP_RECORDING_MS,
  SNIP_IMPORT_ACCEPT,
  formatSnipBytes,
  snipImportKind,
  snipImportMaxBytes,
} from '@/lib/snips';
import { SnipQuotaFullError, type SnipImportMeta } from '@/lib/snipUpload';
import { cn } from '@/lib/utils';
import type { SnipRow } from '@/types/snips';

type BatchProgress = { index: number; total: number; fraction: number };
type ImportFailure = { name: string; reason: string };

/**
 * Import — turn an image or video the user already has into a snip.
 *
 * The point is the *link*, not the file: everything the Snipping Tool gives a
 * capture (a share token, a public page, the owner's retention window, the
 * quota, a card in the library) is exactly what someone wants for a picture
 * that did not come from the snipper — a mock-up a designer sent, a photo of a
 * screen, something saved out of another app. Routing it through the same
 * reservation rather than inventing a second kind of row is what makes all of
 * that true for free.
 *
 * **Videos are accepted too, with their own limits** (MP4, WebM, QuickTime; up
 * to `MAX_SNIP_IMPORT_VIDEO_BYTES` and `MAX_SNIP_RECORDING_MS`). What a recording
 * brings with it that an import does not — a durable on-disk queue, a resumable
 * session, the recorder's wall clock — is replaced by doing the same job in the
 * browser: the duration and dimensions come from loading the file's metadata in
 * a `<video>`, and the poster is a frame drawn from it. **That load is also the
 * "will this play?" test**: a `.mov` holding a codec the browser cannot decode
 * is refused here, before any bytes move, rather than becoming a link nobody can
 * watch.
 *
 * The dimensions are read here, in the browser, because nothing downstream can:
 * the server never sees the bytes (they go straight to Cloud Storage over a
 * signed URL, rule 9i), and they are what reserve the picture's shape on the
 * public page before it loads.
 *
 * **Several files at once, uploaded one after another.** In order rather than
 * in parallel so the progress readout describes one real transfer, and so a
 * full quota stops the batch at the file it refused instead of racing the rest
 * of it into the same refusal. A file that fails does not stop the others; the
 * dialog stays open listing what did not make it, and closes by itself only
 * when everything did.
 */
export function SnipImportDialog({
  open,
  onOpenChange,
  onImport,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uploads one file and returns once the row exists. Errors are surfaced here. */
  onImport: (
    file: File,
    meta: SnipImportMeta,
    onProgress?: (fraction: number) => void,
  ) => Promise<SnipRow>;
  /** Once per batch, with every row that was created, in order. */
  onImported: (snips: SnipRow[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>({ index: 0, total: 0, fraction: 0 });
  const [failures, setFailures] = useState<ImportFailure[]>([]);
  const [batchSize, setBatchSize] = useState(0);

  // `busy` is state, so two calls inside one event both read it as false. The
  // ref flips synchronously and is the real one-batch-at-a-time guard.
  const inFlightRef = useRef(false);

  const handle = useCallback(
    async (fileList: FileList | File[] | undefined | null) => {
      if (inFlightRef.current) return;
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;
      setFailures([]);
      setBatchSize(files.length);

      // Checked against the same allowlist the API route resolves against, so
      // an unsupported file is refused here rather than after an upload that
      // the signed slot was never going to accept.
      const rejected: ImportFailure[] = [];
      const accepted: File[] = [];
      for (const file of files) {
        const kind = snipImportKind(file.type);
        if (!kind) {
          rejected.push({
            name: file.name,
            reason: 'Not a PNG, JPEG, WebP, GIF, MP4, WebM or MOV.',
          });
        } else if (file.size <= 0 || file.size > snipImportMaxBytes(kind)) {
          rejected.push({
            name: file.name,
            reason: `Must be under ${formatSnipBytes(snipImportMaxBytes(kind))}.`,
          });
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length === 0) {
        setFailures(rejected);
        return;
      }

      inFlightRef.current = true;
      setBusy(true);
      const imported: SnipRow[] = [];
      const failed: ImportFailure[] = [...rejected];
      try {
        for (let i = 0; i < accepted.length; i++) {
          const file = accepted[i];
          setProgress({ index: i, total: accepted.length, fraction: 0 });
          const isVideo = snipImportKind(file.type) === 'video';
          const meta: SnipImportMeta | null = isVideo
            ? await readVideoMeta(file)
            : await readImageSize(file);
          if (!meta) {
            // Refused rather than finalised with zeros: width and height are what
            // reserve the box on the public page, and a file the browser cannot
            // decode is one the recipient's browser probably cannot either.
            failed.push({
              name: file.name,
              reason: isVideo
                ? 'Could not be played. It may be corrupt, or use a format browsers cannot decode.'
                : 'Could not be read. It may be corrupt.',
            });
            continue;
          }
          if (meta.durationMs != null && meta.durationMs > MAX_SNIP_RECORDING_MS) {
            failed.push({
              name: file.name,
              reason: `Must be under ${MAX_SNIP_RECORDING_MS / 3_600_000} hour long.`,
            });
            continue;
          }
          try {
            imported.push(
              await onImport(file, meta, fraction =>
                setProgress({ index: i, total: accepted.length, fraction }),
              ),
            );
          } catch (err) {
            failed.push({
              name: file.name,
              reason: err instanceof Error ? err.message : 'Could not be imported.',
            });
            if (err instanceof SnipQuotaFullError) {
              // Every remaining reservation would get the same answer.
              for (const rest of accepted.slice(i + 1)) {
                failed.push({ name: rest.name, reason: 'Not attempted — the snip quota is full.' });
              }
              break;
            }
          }
        }
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }

      if (imported.length > 0) await onImported(imported);
      setFailures(failed);
      if (failed.length === 0) onOpenChange(false);
    },
    [onImport, onImported, onOpenChange],
  );

  const overall =
    progress.total > 0 ? (progress.index + progress.fraction) / progress.total : 0;

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      {/* The drop target is the whole dialog, not only the dashed box. A file
          released a few pixels outside it used to do nothing at all — the app
          window's `will-navigate` guard correctly refuses the `file://`
          navigation, so there was no damage and also no feedback, which is the
          worst pair. Aiming is now not part of the task. */}
      <DialogContent
        className="sm:max-w-md"
        onDragOver={event => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (!busy) void handle(event.dataTransfer.files);
        }}
      >
        <DialogHeader>
          <DialogTitle>Import images or videos</DialogTitle>
          <DialogDescription>
            Each one gets a share link, a card and the same auto-delete window as
            a capture. Images (PNG, JPEG, WebP, GIF) up to {formatSnipBytes(MAX_SNIP_BYTES)};
            videos (MP4, WebM, MOV) up to {formatSnipBytes(MAX_SNIP_IMPORT_VIDEO_BYTES)} and
            an hour long.
          </DialogDescription>
        </DialogHeader>

        {/* A button, not a div with a click handler. The whole area is the drop
            target AND the picker — a drop zone that cannot be reached with a
            keyboard is a feature half the people on the page cannot use, and
            "click to browse" written under a `div` is a promise the tab order
            does not keep. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          // No drag handlers here: `drop` bubbles, so a copy on this button ran
          // `handle` a second time via DialogContent's and imported the file
          // twice whenever it landed on the box. The dialog-wide target covers it.
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-[120ms]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            // The Action Blue tint is the one voice, and here it means "let go
            // and this lands" — a selection state, which is exactly the job the
            // accent has (DESIGN.md §2).
            dragging
              ? 'border-action-blue bg-action-blue/10'
              : 'border-white/15 bg-white/[0.025] hover:bg-white/[0.045]',
            busy && 'cursor-progress opacity-70',
          )}
        >
          <Upload className="size-5 text-zinc-400" aria-hidden />
          <span className="text-sm text-zinc-300">
            {busy
              ? progress.total > 1
                ? `Uploading ${progress.index + 1} of ${progress.total}… ${Math.round(progress.fraction * 100)}%`
                : `Uploading… ${Math.round(progress.fraction * 100)}%`
              : 'Drop images or videos here, or click to choose'}
          </span>
          {/* A track, not a spinner. The number above is the fact; this is the
              shape of it, so a stalled upload is visible as a bar that stops
              rather than a spinner that keeps turning either way. The bar is
              the whole batch; the number is the file in flight. */}
          {busy && (
            <span
              aria-hidden
              className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-white/10"
            >
              <span
                className="block h-full rounded-full bg-action-blue transition-[width] duration-[120ms] ease-out"
                style={{ width: `${Math.max(2, Math.round(overall * 100))}%` }}
              />
            </span>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={SNIP_IMPORT_ACCEPT}
          multiple
          className="sr-only"
          // Copied out, then cleared, so choosing the same files twice in a row
          // still fires `change` — clearing empties the live FileList.
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void handle(files);
          }}
        />

        {failures.length > 0 && (
          // Inline and in the dialog, not a toast: the user is looking right
          // here, and the fix is to pick a different file in this same panel.
          // Anything that did import is already in the library behind it.
          <div className="text-sm text-destructive" role="alert">
            {batchSize === 1 ? (
              <p>{failures[0].reason}</p>
            ) : (
              <>
                <p>
                  {failures.length} of {batchSize} could not be imported:
                </p>
                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                  {failures.map((failure, i) => (
                    <li key={i} className="break-words">
                      <span className="text-zinc-300">{failure.name}</span>
                      {' — '}
                      {failure.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The image's intrinsic size, or null if it will not decode.
 *
 * `createImageBitmap` where it exists — it decodes off the main thread, which
 * matters for the multi-megapixel photo this dialog is most likely to be handed
 * — with an image element on an object URL as the fallback. Both revoke the URL,
 * because a leaked blob URL pins the whole file in memory for the life of the
 * document, and this page is one that stays open for weeks (rule 9c).
 */
async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size.width > 0 && size.height > 0 ? size : null;
    } catch {
      // Fall through — some browsers refuse animated GIFs here but decode them
      // through an image element perfectly well.
    }
  }

  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size.width > 0 && size.height > 0 ? size : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * A video's size, length and a poster frame — or null if the browser cannot play
 * it.
 *
 * Loading `metadata` is the playability test: a container the engine cannot
 * open, or one whose video track it cannot decode (an HEVC `.mov` in a browser
 * without that codec), either errors or reports a 0×0 picture, and both are
 * refused here rather than imported as a link that will not play.
 *
 * The poster is best-effort and independent of that verdict — a seek or a
 * canvas that will not cooperate yields `poster: null`, and the import carries
 * on. The frame is taken a quarter of the way in, capped at a second: the very
 * first frame is so often black, but a long clip's thumbnail does not need to
 * come from deep inside it. Drawn at most `POSTER_MAX_EDGE` px on its long side;
 * it is a grid thumbnail and a link-preview source, and a full-resolution PNG of
 * a 4K frame would be several megabytes for a card the user is scanning.
 *
 * Every exit revokes the object URL and detaches the source — a blob URL pins
 * the whole file for the life of the document, and a 500 MB video is the worst
 * thing to leak in a page that stays open for weeks (rule 9c).
 */
const POSTER_MAX_EDGE = 1280;
const VIDEO_METADATA_TIMEOUT_MS = 15_000;

async function readVideoMeta(file: File): Promise<SnipImportMeta | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;

  const release = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    const loaded = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), VIDEO_METADATA_TIMEOUT_MS);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      video.src = url;
    });
    const { videoWidth: width, videoHeight: height, duration } = video;
    if (!loaded || width <= 0 || height <= 0 || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    return {
      width,
      height,
      durationMs: Math.round(duration * 1000),
      poster: await captureVideoPoster(video, Math.min(1, duration / 4), width, height),
    };
  } catch {
    return null;
  } finally {
    release();
  }
}

/** One frame as a PNG, or null on any failure. Never throws. */
async function captureVideoPoster(
  video: HTMLVideoElement,
  at: number,
  width: number,
  height: number,
): Promise<Blob | null> {
  try {
    const seeked = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), VIDEO_METADATA_TIMEOUT_MS);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      video.currentTime = at;
    });
    if (!seeked) return null;

    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}
