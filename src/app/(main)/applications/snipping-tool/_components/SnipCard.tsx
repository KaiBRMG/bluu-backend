'use client';

import { useMemo, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { SURFACE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { SnipRow } from '@/types/snips';

/** `1536` → `1.5 MB`. Whole-number KB, one decimal past it. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A fixed, locale-independent date — `2026-09-19`.
 *
 * The ISO string is UTC, and this deliberately slices it rather than formatting
 * it: an expiry is the day the sweep runs, which is a server-side fact, not the
 * viewer's wall clock.
 */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function SnipCard({
  snip,
  timezone,
  onCopy,
  onDelete,
}: {
  snip: SnipRow;
  /** Resolved by `useViewerTimezone` upstream — never a raw `users` value (rule 9g). */
  timezone: string;
  onCopy: (snip: SnipRow) => void;
  onDelete: (snip: SnipRow) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Date **and** time, in the viewer's zone. A library is mostly same-day rows,
  // so a date alone repeats down the whole grid and distinguishes nothing —
  // which matters more now that the grid pages rather than ending at a screenful.
  const stamp = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [timezone],
  );
  const taken = stamp.format(new Date(snip.createdAt)).replace(',', '');

  return (
    <li className={cn('flex flex-col overflow-hidden rounded-xl', SURFACE)}>
      {/* The preview is the row's identity — a screenshot has no name, so the
          picture is the only thing that tells one from another. `object-contain`
          on a fixed box rather than `cover`: cropping a crop is how a user loses
          the one detail they took the shot for. */}
      <a
        href={snip.imageUrl}
        target="_blank"
        rel="noreferrer"
        className="flex h-40 items-center justify-center overflow-hidden border-b border-white/[0.07] bg-black/30 transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        aria-label={`Open the snip taken ${taken} at full size`}
        title="Open full size"
      >
        {/* A raw <img>, for the same reason the public page uses one: next/image
            would pull the bytes through Vercel's optimizer (rule 9i), and `src`
            here is a 302 straight to Cloud Storage. */}
        {previewFailed ? (
          // A preview that will not load is worth saying plainly: the link may
          // still be good, and a broken-image glyph reads as a bug in the page
          // rather than as a fact about this row.
          <span className="px-3 text-center text-xs text-zinc-400">Preview unavailable</span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={snip.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPreviewFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </a>

      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs text-zinc-400">
            <span className="tabular-nums">{taken}</span>
            <span aria-hidden> · </span>
            <span className="tabular-nums">{snip.width} × {snip.height}</span>
            <span aria-hidden> · </span>
            <span className="tabular-nums">{formatBytes(snip.bytes)}</span>
          </p>
          {snip.expiresAt && (
            // Stated rather than implied: a link that will stop working is a
            // fact the person handing it out needs before they hand it out.
            <p className="truncate text-[11px] text-zinc-400">
              Deletes <span className="tabular-nums">{formatDate(snip.expiresAt)}</span>
            </p>
          )}
        </div>

        {/* Always rendered, never hover-revealed: copying the link is the entire
            reason this page exists, and hiding the primary action until hover
            also hides it from the keyboard. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-400 hover:text-zinc-200"
            aria-label={`Copy the link to the snip taken ${taken}`}
            onClick={() => onCopy(snip)}
          >
            <Link2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-400 hover:text-destructive"
            aria-label={`Delete the snip taken ${taken}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Confirmed, not undoable. The bytes go from the bucket and the link dies
          for everyone holding it, so there is nothing an Undo toast could put
          back — which is exactly the case DESIGN.md reserves a dialog for. */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this snip?</AlertDialogTitle>
            <AlertDialogDescription>
              The image is deleted permanently and the link stops working for
              anyone you have already sent it to. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async event => {
                // The primitive closes the dialog on click; holding it open
                // while the delete is in flight is what stops a second click
                // firing a second request against a row that is already gone.
                event.preventDefault();
                setDeleting(true);
                try {
                  await onDelete(snip);
                  setConfirming(false);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
