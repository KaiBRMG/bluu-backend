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
  SNIP_IMPORT_ACCEPT,
  formatSnipBytes,
  isSnipImportType,
} from '@/lib/snips';
import { cn } from '@/lib/utils';

/**
 * Import — turn an image the user already has into a snip.
 *
 * The point is the *link*, not the file: everything the Snipping Tool gives a
 * capture (a 160-bit share token, a public page, the owner's retention window,
 * the quota, a card in the library) is exactly what someone wants for a picture
 * that did not come from the snipper — a mock-up a designer sent, a photo of a
 * screen, something saved out of another app. Routing it through the same
 * reservation rather than inventing a second kind of row is what makes all of
 * that true for free.
 *
 * **Stills only, and deliberately.** A recording carries a durable on-disk
 * queue, a poster frame and a resumable upload session, none of which mean
 * anything for a file that is already sitting on the user's disk — and a video
 * import would have to answer "how long is it?" without a recorder's wall clock
 * to ask.
 *
 * The dimensions are read here, in the browser, because nothing downstream can:
 * the server never sees the bytes (they go straight to Cloud Storage over a
 * signed URL, rule 9i), and they are what reserve the picture's shape on the
 * public page before it loads.
 */
export function SnipImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uploads and returns once the row exists. Errors are surfaced here. */
  onImport: (
    file: File,
    dimensions: { width: number; height: number },
    onProgress?: (fraction: number) => void,
  ) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    async (file: File | undefined | null) => {
      setError(null);
      if (!file) return;
      // Checked against the same allowlist the API route resolves against, so
      // an unsupported file is refused here rather than after an upload that
      // the signed slot was never going to accept.
      if (!isSnipImportType(file.type)) {
        setError('That file type is not supported. Use a PNG, JPEG, WebP or GIF.');
        return;
      }
      if (file.size <= 0 || file.size > MAX_SNIP_BYTES) {
        setError(`Images must be under ${formatSnipBytes(MAX_SNIP_BYTES)}.`);
        return;
      }

      setBusy(true);
      setProgress(0);
      try {
        const dimensions = await readImageSize(file);
        if (!dimensions) {
          // Refused rather than finalised with zeros: width and height are what
          // reserve the box on the public page, and a file the browser cannot
          // decode is one the recipient's browser probably cannot either.
          setError('That image could not be read. It may be corrupt.');
          return;
        }
        await onImport(file, dimensions, setProgress);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That image could not be imported');
      } finally {
        setBusy(false);
      }
    },
    [onImport, onOpenChange],
  );

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
          if (!busy) void handle(event.dataTransfer.files?.[0]);
        }}
      >
        <DialogHeader>
          <DialogTitle>Import an image</DialogTitle>
          <DialogDescription>
            It gets a share link, a card and the same auto-delete window as a
            capture. PNG, JPEG, WebP or GIF, up to {formatSnipBytes(MAX_SNIP_BYTES)}.
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
          onDragOver={event => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            if (!busy) void handle(event.dataTransfer.files?.[0]);
          }}
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
              ? `Uploading… ${Math.round(progress * 100)}%`
              : 'Drop an image here, or click to choose one'}
          </span>
          {/* A track, not a spinner. The number above is the fact; this is the
              shape of it, so a stalled upload is visible as a bar that stops
              rather than a spinner that keeps turning either way. */}
          {busy && (
            <span
              aria-hidden
              className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-white/10"
            >
              <span
                className="block h-full rounded-full bg-action-blue transition-[width] duration-[120ms] ease-out"
                style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
              />
            </span>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={SNIP_IMPORT_ACCEPT}
          className="sr-only"
          // Cleared after every pick so choosing the same file twice in a row
          // still fires `change`.
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void handle(file);
          }}
        />

        {error && (
          // Inline and in the dialog, not a toast: the user is looking right
          // here, and the fix is to pick a different file in this same panel.
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
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
