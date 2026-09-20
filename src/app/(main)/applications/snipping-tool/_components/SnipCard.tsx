'use client';

import { useMemo, useState } from 'react';
import { Link2, Play, Trash2, Video } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { formatSnipBytes, formatSnipDuration, snipExpiryLabel } from '@/lib/snips';
import { cn } from '@/lib/utils';
import type { SnipRow } from '@/types/snips';

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
  const isVideo = snip.kind === 'video';
  // A recording has a poster unless its upload failed. Either way the grid
  // shows a still and never a `<video>`: 24 media elements in a scrolling grid
  // is 24 pipelines and 24 range-request storms, for cells the user is only
  // scanning. The play affordance says what the row is; the public page plays
  // it.
  const preview = previewFailed ? null : snip.imageUrl;

  return (
    <li className={cn('flex flex-col overflow-hidden rounded-xl', SURFACE)}>
      {/* The preview is the row's identity — a screenshot has no name, so the
          picture is the only thing that tells one from another. `object-contain`
          on a fixed box rather than `cover`: cropping a crop is how a user loses
          the one detail they took the shot for.

          It opens `shareUrl` (the public page), NOT `imageUrl`. `imageUrl` is a
          302 to a signed Storage URL, so navigating to it lands the browser on
          `storage.googleapis.com/...` with the signed credential in the address
          bar and the bar's history. Opening the share page also shows the owner
          exactly what a recipient sees, which is the more useful click. */}
      <a
        href={snip.shareUrl}
        target="_blank"
        rel="noreferrer"
        className="relative flex h-40 items-center justify-center overflow-hidden border-b border-white/[0.07] bg-black/30 transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        aria-label={`Open the shared page for the ${isVideo ? 'recording' : 'snip'} taken ${taken}`}
        title="Open shared page"
      >
        {/* A raw <img>, for the same reason the public page uses one: next/image
            would pull the bytes through Vercel's optimizer (rule 9i), and `src`
            here is a 302 straight to Cloud Storage. */}
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={preview}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPreviewFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        ) : isVideo ? (
          // A recording whose poster never landed. The row is fine and the
          // link works, so this is a quiet stand-in rather than a failure —
          // and it still says what kind of thing the row is, which is the one
          // job the preview had.
          <Video className="size-7 text-zinc-500" aria-hidden />
        ) : (
          // A preview that will not load is worth saying plainly: the link may
          // still be good, and a broken-image glyph reads as a bug in the page
          // rather than as a fact about this row.
          <span className="px-3 text-center text-xs text-zinc-400">Preview unavailable</span>
        )}

        {isVideo && (
          // Two marks, because each answers a different question at a glance:
          // the play badge says "this one moves", the duration says whether it
          // is worth opening. Both sit on their own scrim so they stay legible
          // over a poster frame of unknown brightness.
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/20">
                <Play className="size-4 translate-x-[1px] fill-white text-white" />
              </span>
            </span>
            {snip.durationMs != null && (
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {formatSnipDuration(snip.durationMs)}
              </span>
            )}
          </>
        )}
      </a>

      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs text-zinc-400">
            <span className="tabular-nums">{taken}</span>
            <span aria-hidden> · </span>
            <span className="tabular-nums">{snip.width} × {snip.height}</span>
            <span aria-hidden> · </span>
            <span className="tabular-nums">{formatSnipBytes(snip.bytes)}</span>
          </p>
          {snip.expiresAt && (
            // Stated rather than implied: a link that will stop working is a
            // fact the person handing it out needs before they hand it out.
            //
            // A duration, not a date — "Deletes in 2 months" answers the
            // question the reader actually has, where "Deletes 2027-03-20"
            // made them do the arithmetic. The exact moment is still here for
            // anyone who wants it, on the `title` and in `dateTime`, which is
            // also what keeps this a real `<time>` rather than a string.
            <p className="truncate text-[11px] text-zinc-400">
              <time dateTime={snip.expiresAt} title={snip.expiresAt.slice(0, 10)}>
                {snipExpiryLabel(snip.expiresAt)}
              </time>
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
            aria-label={`Copy the link to the ${isVideo ? 'recording' : 'snip'} taken ${taken}`}
            onClick={() => onCopy(snip)}
          >
            <Link2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-zinc-400 hover:text-destructive"
            aria-label={`Delete the ${isVideo ? 'recording' : 'snip'} taken ${taken}`}
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
            <AlertDialogTitle>Delete this {isVideo ? 'recording' : 'snip'}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {isVideo ? 'recording' : 'image'} is deleted permanently and the
              link stops working for anyone you have already sent it to. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            {/* `variant="destructive"`, not the default: shadcn's `--primary`
                resolves to near-white in this app, which would give "Delete"
                and "Cancel" the same visual weight on a dialog whose action
                takes the bytes out of the bucket and kills the link for
                everyone holding it. */}
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
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
