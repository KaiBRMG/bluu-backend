'use client';

import { useState } from 'react';
import {
  FileQuestion,
  Image as ImageIcon,
  Loader2,
  Lock,
  Music,
  Paperclip,
  Play,
  RotateCw,
  ShieldAlert,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useInViewport, useResolvedMedia, type MediaStatus } from '@/hooks/useOnlyFansMedia';
import type { OFAttachmentRow, OFMessageRow } from '@/hooks/useOnlyFansMessages';
import { formatMoney } from '../_lib/format';

/**
 * Media on a message.
 *
 * Three constraints shape this component, and each one is visible in the markup:
 *
 * 1. **Resolving a tile can cost provider credits.** Nothing is requested until
 *    it scrolls into view, every tile asks for the *preview* variant rather than
 *    the full file, and the full file is fetched only when the operator opens
 *    the lightbox and asks for it.
 * 2. **DRM media cannot be played here at all** — stock Electron has no Widevine
 *    CDM. Such an attachment renders as its poster with an explicit line saying
 *    so. A player that silently fails would be worse than no player.
 * 3. **Every tile reserves its own space from metadata before the image lands.**
 *    The thread restores `scrollTop` around content-height changes; media that
 *    pops in at its natural size after the fact would move the reading position
 *    under the operator on every resolve.
 */

/** Fallbacks when the provider reported no dimensions. */
const DEFAULT_RATIO: Record<string, number> = { video: 16 / 9, gif: 1, photo: 4 / 3 };

function ratioOf(attachment: OFAttachmentRow): number {
  if (attachment.width && attachment.height) return attachment.width / attachment.height;
  return DEFAULT_RATIO[attachment.type] ?? 4 / 3;
}

/**
 * The variant a tile displays. `preview` (~960px) rather than `thumb` (300²)
 * because the same URL is reused as the lightbox's image and a video's poster —
 * one resolve per attachment on the common path instead of two.
 */
function previewUrlOf(attachment: OFAttachmentRow): string | null {
  return attachment.urls.preview ?? attachment.urls.thumb ?? null;
}

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'video') return <Video className={className} />;
  if (type === 'audio') return <Music className={className} />;
  if (type === 'photo' || type === 'gif') return <ImageIcon className={className} />;
  return <FileQuestion className={className} />;
}

function typeLabel(attachment: OFAttachmentRow): string {
  const base = attachment.type === 'other' ? 'Attachment' : attachment.type;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MessageAttachments({ message }: { message: OFMessageRow }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const attachments = message.attachments ?? [];

  // The provider counts media on a chat row's embedded `lastMessage` without
  // describing it, and locked media is sometimes counted but not listed. A count
  // with nothing to show is still worth telling the operator about.
  if (attachments.length === 0) {
    return message.mediaCount > 0 ? (
      <span
        className={cn(
          'mt-1 flex items-center gap-1.5 text-xs text-zinc-400',
          message.text && 'border-t border-white/[0.07] pt-1.5',
        )}
      >
        <Paperclip className="size-3" />
        {message.mediaCount} attachment{message.mediaCount === 1 ? '' : 's'}
      </span>
    ) : null;
  }

  const open = openIndex === null ? null : (attachments[openIndex] ?? null);

  return (
    <>
      <div
        className={cn(
          'mt-1.5 grid gap-1.5',
          attachments.length > 1 && 'grid-cols-2',
          message.text && 'border-t border-white/[0.07] pt-1.5',
        )}
      >
        {attachments.map((attachment, i) => (
          <MediaTile
            key={attachment.id}
            attachment={attachment}
            // The adapter now zeroes `price` on tips, but rows mirrored to
            // Firestore before that change still carry the tip amount there —
            // and a locked tile must never label itself "$50 locked" off it.
            price={message.isTip ? 0 : message.price}
            single={attachments.length === 1}
            onOpen={() => setOpenIndex(i)}
          />
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpenIndex(null)}>
        <DialogContent className="max-w-3xl border-white/[0.07] bg-[#171717] p-2 sm:max-w-3xl">
          {open && (
            <>
              {/* The dialog needs an accessible name; the media is the content. */}
              <DialogTitle className="sr-only">
                {typeLabel(open)} attachment from this conversation
              </DialogTitle>
              <DialogDescription className="sr-only">
                {open.isDrm
                  ? 'DRM-protected media. A preview is shown; it cannot be played in this app.'
                  : 'Full-size view of the attachment.'}
              </DialogDescription>
              <MediaViewer attachment={open} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Tile ───────────────────────────────────────────────────────────

function MediaTile({
  attachment,
  price,
  single,
  onOpen,
}: {
  attachment: OFAttachmentRow;
  price: number;
  single: boolean;
  onOpen: () => void;
}) {
  // A thread is scrolled past, not read end to end, so resolving only what
  // reaches the viewport is a cost control before it is a perf one.
  const { ref, inView } = useInViewport<HTMLDivElement>();

  const previewUrl = previewUrlOf(attachment);
  const { url, status, retry, onLoadError } = useResolvedMedia(previewUrl, inView);

  const locked = !attachment.canView;
  const interactive = !!previewUrl || attachment.type === 'audio';

  return (
    <div
      ref={ref}
      // Reserved from metadata so the thread's scroll anchoring is not fighting
      // an image that changes the bubble's height after it loads.
      style={{ aspectRatio: single ? ratioOf(attachment) : 1 }}
      className={cn(
        'relative overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.04]',
        single && 'max-h-80 w-full max-w-sm',
      )}
    >
      {url && (
        // A short-lived signed provider URL cannot go through next/image: it is
        // not a configured remote host, and the link is dead long before an
        // optimizer cache entry would pay for itself.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          // Resolved links are cached optimistically for minutes; this is what
          // makes that safe. A link that has actually died re-resolves once.
          onError={onLoadError}
          loading="lazy"
          decoding="async"
          className={cn('size-full object-cover', locked && 'blur-md scale-110')}
          draggable={false}
        />
      )}

      {!url && <TilePlaceholder attachment={attachment} status={previewUrl ? status : 'idle'} />}

      {/* Overlays, outermost meaning first: locked outranks DRM outranks play. */}
      {locked ? (
        <OverlayPill>
          <Lock className="size-4 text-orange-400" />
          <span className="text-orange-400">
            {price > 0 ? `${formatMoney(price)} locked` : 'Locked'}
          </span>
        </OverlayPill>
      ) : attachment.isDrm ? (
        <OverlayPill>
          <ShieldAlert className="size-4 text-zinc-400" />
          <span>DRM · not playable</span>
        </OverlayPill>
      ) : attachment.type === 'video' || attachment.type === 'audio' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-black/55">
            <Play className="size-4 fill-white text-white" />
          </span>
        </span>
      ) : null}

      {attachment.duration !== null && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
          {formatDuration(attachment.duration)}
        </span>
      )}

      {status === 'error' && previewUrl && (
        <span className="absolute inset-x-0 bottom-0 flex justify-center pb-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={retry}
            className="h-6 gap-1 bg-black/60 px-2 text-[11px] text-zinc-400 hover:text-white"
          >
            <RotateCw className="size-3" />
            Retry
          </Button>
        </span>
      )}

      {interactive && (
        // A full-bleed button rather than an onClick on the wrapper: it is
        // focusable and reachable by keyboard for free, and hover is a ring
        // change rather than a filter — a `brightness` here would make Chromium
        // re-rasterise the image on every enter and leave.
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${typeLabel(attachment).toLowerCase()} attachment`}
          className="absolute inset-0 rounded-lg ring-inset transition-all hover:ring-2 hover:ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        />
      )}
    </div>
  );
}

/** The centred pill both the lock and the DRM notice ride on. */
function OverlayPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-zinc-400">
        {children}
      </span>
    </span>
  );
}

/**
 * What fills a tile before (or instead of) an image.
 *
 * `idle` covers the case worth understanding: live messages arriving by webhook
 * carry attachment *metadata* but no URLs, because CDN links expire in about a
 * minute and are deliberately never mirrored. The tile still says what the media
 * is; refreshing the thread pulls links that can be resolved.
 */
function TilePlaceholder({
  attachment,
  status,
}: {
  attachment: OFAttachmentRow;
  status: MediaStatus;
}) {
  if (status === 'loading') {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  }

  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center text-zinc-400">
      <TypeIcon type={attachment.type} className="size-5" />
      <span className="text-[11px]">
        {status === 'expired'
          ? 'Link expired — refresh'
          : status === 'error'
            ? 'Could not load'
            : typeLabel(attachment)}
      </span>
    </span>
  );
}

// ─── Lightbox ───────────────────────────────────────────────────────

/**
 * The opened attachment.
 *
 * Photos show the already-resolved preview immediately and offer the full file
 * as an explicit second step — a full-size resolve is a second billed download,
 * so it is the operator's choice rather than a side effect of clicking.
 * Non-DRM video resolves its file on open (there is nothing useful to show
 * without it); DRM video never does, because there is no file to resolve.
 */
function MediaViewer({ attachment }: { attachment: OFAttachmentRow }) {
  const [wantFull, setWantFull] = useState(false);

  const previewUrl = previewUrlOf(attachment);
  const playable = !attachment.isDrm && attachment.canView && !!attachment.urls.full;
  const isMedia = attachment.type === 'video' || attachment.type === 'audio';

  const preview = useResolvedMedia(previewUrl, true);
  // Video/audio needs the file to be of any use at all; a photo waits to be asked.
  const full = useResolvedMedia(
    playable && (isMedia || wantFull) ? attachment.urls.full : null,
    playable && (isMedia || wantFull),
  );

  if (attachment.isDrm) {
    return (
      <div className="space-y-3">
        <PreviewFrame attachment={attachment} url={preview.url} onError={preview.onLoadError} />
        <p className="px-2 pb-1 text-sm text-zinc-400">
          <ShieldAlert className="mr-1.5 inline size-4" />
          This video is DRM-protected and cannot be played here. Open it in the OnlyFans app or
          website to watch it.
        </p>
      </div>
    );
  }

  if (!attachment.canView) {
    return (
      <div className="space-y-3">
        <PreviewFrame attachment={attachment} url={preview.url} onError={preview.onLoadError} blurred />
        <p className="px-2 pb-1 text-sm text-zinc-400">
          <Lock className="mr-1.5 inline size-4" />
          Locked — the fan has not unlocked this yet, so only the preview is available.
        </p>
      </div>
    );
  }

  if (attachment.type === 'audio') {
    return (
      <div className="p-4">
        {full.url ? (
          <audio src={full.url} controls className="w-full" />
        ) : (
          <ViewerStatus status={full.status} onRetry={full.retry} />
        )}
      </div>
    );
  }

  if (attachment.type === 'video') {
    return full.url ? (
      <video
        src={full.url}
        controls
        autoPlay
        poster={preview.url ?? undefined}
        className="max-h-[75vh] w-full rounded-md bg-black"
      />
    ) : (
      <div className="p-6">
        <ViewerStatus status={full.status} onRetry={full.retry} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PreviewFrame
        attachment={attachment}
        url={full.url ?? preview.url}
        onError={full.url ? full.onLoadError : preview.onLoadError}
      />
      {!wantFull && attachment.urls.full && (
        <div className="flex justify-end px-2 pb-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setWantFull(true)}
            className="text-zinc-400 hover:text-white"
          >
            View full resolution
          </Button>
        </div>
      )}
      {wantFull && full.status === 'loading' && (
        <p className="px-2 pb-1 text-right text-xs text-zinc-400">Loading full resolution…</p>
      )}
    </div>
  );
}

function PreviewFrame({
  attachment,
  url,
  blurred,
  onError,
}: {
  attachment: OFAttachmentRow;
  url: string | null;
  blurred?: boolean;
  onError?: () => void;
}) {
  if (!url) {
    return (
      <div
        style={{ aspectRatio: ratioOf(attachment) }}
        className="flex max-h-[70vh] w-full items-center justify-center rounded-md bg-white/[0.04] text-zinc-400"
      >
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the tile above.
    <img
      src={url}
      alt=""
      onError={onError}
      decoding="async"
      className={cn('max-h-[75vh] w-full rounded-md object-contain', blurred && 'blur-lg')}
    />
  );
}

function ViewerStatus({ status, onRetry }: { status: MediaStatus; onRetry: () => void }) {
  if (status === 'loading' || status === 'idle') {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 text-sm text-zinc-400">
      <p>{status === 'expired' ? 'This link expired. Refresh the thread to load it.' : 'Could not load this media.'}</p>
      {status === 'error' && (
        <Button size="sm" variant="ghost" onClick={onRetry} className="gap-1 text-zinc-400 hover:text-white">
          <RotateCw className="size-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
