'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  useInViewport,
  useResolvedFile,
  useResolvedMedia,
  type MediaRef,
  type MediaStatus,
} from '@/hooks/useOnlyFansMedia';
import type { OFAttachmentRow, OFMessageRow } from '@/hooks/useOnlyFansMessages';
import type { OFMediaVariant } from '@/lib/onlyfans/types';
import { estimateCredits, formatBytes, formatMoney } from '../_lib/format';

/**
 * Media on a message.
 *
 * Four constraints shape this component, and each one is visible in the markup:
 *
 * 1. **The provider bills media by the megabyte, once per file.** Nothing is
 *    requested until it scrolls into view; tiles ask for the *preview* rendition;
 *    and a video plays a **240p/720p rendition** rather than the source master,
 *    which on a phone-shot clip is the difference between tens of credits and
 *    several hundred. Source resolution is always an explicit, priced choice.
 * 2. **Nothing autoplays.** A video used to start downloading the moment its
 *    tile was clicked, so opening the wrong attachment cost more than a day of
 *    ordinary browsing. Play is a button now.
 * 3. **DRM media cannot be played here at all** — stock Electron has no Widevine
 *    CDM. Such an attachment renders as its poster with an explicit line saying
 *    so. A player that silently fails would be worse than no player.
 * 4. **Every tile reserves its own space from metadata before the image lands.**
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
 * What a tile displays.
 *
 * `preview` (~960px) rather than `thumb` (300²) because the same file is reused
 * as the lightbox's image and as a video's poster — one cached file per
 * attachment on the common path instead of two. Asking for `thumb` would not
 * save anything anyway: both land under the provider's 1-credit floor.
 *
 * The URL may be null and the ref is still worth making. A message that arrived
 * by webhook has its attachment metadata mirrored but never its links, and the
 * media cache can serve any file it has already stored from the id alone — so
 * live messages now show their images instead of a grey placeholder, provided
 * the file has been seen once before.
 */
function previewRefOf(attachment: OFAttachmentRow): MediaRef {
  if (!attachment.urls.preview && attachment.urls.thumb) {
    return { id: attachment.id, variant: 'thumb', url: attachment.urls.thumb };
  }
  return { id: attachment.id, variant: 'preview', url: attachment.urls.preview };
}

interface QualityOption {
  variant: OFMediaVariant;
  label: string;
  url: string | null;
  /** Bytes, when known. Only the source master ever reports one. */
  bytes: number | null;
}

/**
 * The renditions a video can be played at, cheapest first.
 *
 * `videoSources` on the provider's payload carries 240p and 720p transcodes of
 * every non-DRM video. They were being dropped on the floor before, so every
 * play fetched `files.full` — the source file, routinely 100–250MB. Offering the
 * renditions first is the single largest cost reduction available on this
 * surface.
 *
 * When the row carries no links at all (mirrored from a webhook), a single
 * source-variant option with a null URL is still returned: the cache may already
 * hold the file, and if it does not the viewer says so rather than showing
 * nothing.
 */
function qualityOptions(attachment: OFAttachmentRow): QualityOption[] {
  const options: QualityOption[] = [];
  if (attachment.urls.video240) {
    options.push({ variant: 'video240', label: '240p', url: attachment.urls.video240, bytes: null });
  }
  if (attachment.urls.video720) {
    options.push({ variant: 'video720', label: '720p', url: attachment.urls.video720, bytes: null });
  }
  // Source is offered when there is a source link to offer — or when it is the
  // only thing left, in which case a null URL is still worth trying, because the
  // cache may hold the file from a sighting that did have one.
  if (attachment.urls.full || options.length === 0) {
    options.push({
      variant: 'full',
      label: options.length > 0 ? 'Source' : 'Play',
      url: attachment.urls.full,
      bytes: attachment.sizeBytes ?? null,
    });
  }
  return options;
}

/** Prefer 720p, then 240p, then the source master. */
function defaultQuality(options: QualityOption[]): OFMediaVariant {
  return (
    options.find((o) => o.variant === 'video720')?.variant ??
    options.find((o) => o.variant === 'video240')?.variant ??
    'full'
  );
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

  const mediaRef = previewRefOf(attachment);
  const { url, status, retry, onLoadError } = useResolvedMedia(mediaRef, inView);

  const locked = !attachment.canView;
  // Openable if there is anything the lightbox could show: a poster it already
  // has, a playable rendition, or audio (which has no poster at all).
  const interactive =
    !!url ||
    !!attachment.urls.full ||
    !!attachment.urls.video720 ||
    !!attachment.urls.video240 ||
    attachment.type === 'audio';

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
        // A signed URL cannot go through next/image: it is not a configured
        // remote host, and an optimizer cache entry would never pay for itself
        // against a link that rotates.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          // Cached links are handed out optimistically; this is what makes that
          // safe. One that has actually died re-resolves once.
          onError={onLoadError}
          loading="lazy"
          decoding="async"
          className={cn('size-full object-cover', locked && 'blur-md scale-110')}
          draggable={false}
        />
      )}

      {!url && <TilePlaceholder attachment={attachment} status={status} />}

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

      {status === 'error' && (
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
 * `uncached` is the case worth understanding: a live message carries attachment
 * metadata but no links, so the only way to show it is from a file the cache has
 * already stored. The first time a fan sends something, that has not happened
 * yet — refreshing the thread fetches links the cache can fill itself from.
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
        {status === 'expired' || status === 'uncached'
          ? 'Refresh to load'
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
 * Everything expensive here is opt-in. Photos show the already-cached preview
 * immediately and offer source resolution as a second, priced step. Video shows
 * its poster and a play button, defaulting to the 720p rendition — it does not
 * autoplay, and it does not reach for the source master unless asked. DRM video
 * resolves nothing at all, because there is no file to resolve.
 */
function MediaViewer({ attachment }: { attachment: OFAttachmentRow }) {
  const options = useMemo(() => qualityOptions(attachment), [attachment]);
  const [quality, setQuality] = useState<OFMediaVariant>(() => defaultQuality(options));
  const [playing, setPlaying] = useState(false);
  const [wantFull, setWantFull] = useState(false);

  const playable = !attachment.isDrm && attachment.canView;
  const isMedia = attachment.type === 'video' || attachment.type === 'audio';
  const chosen = options.find((o) => o.variant === quality) ?? options[options.length - 1];

  const preview = useResolvedMedia(previewRefOf(attachment), true);

  // Audio has nothing to show without the file, so it loads on open. Video waits
  // for the play button; a photo waits for "source resolution".
  const wantFile = playable && (attachment.type === 'audio' || (isMedia ? playing : wantFull));
  const fileVariant: OFMediaVariant = isMedia ? chosen.variant : 'full';
  const fileUrl = isMedia ? chosen.url : attachment.urls.full;
  const file = useResolvedFile(
    wantFile ? { id: attachment.id, variant: fileVariant, url: fileUrl } : null,
    wantFile,
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
        {file.url ? (
          <audio src={file.url} controls className="w-full" />
        ) : (
          <ViewerStatus status={file.status} slow={file.slow} onRetry={file.retry} />
        )}
      </div>
    );
  }

  if (attachment.type === 'video') {
    if (file.url) return <VideoPlayer src={file.url} poster={preview.url} />;

    return (
      <div className="space-y-3">
        <PreviewFrame attachment={attachment} url={preview.url} onError={preview.onLoadError} />
        {playing ? (
          <div className="pb-2">
            <ViewerStatus status={file.status} slow={file.slow} onRetry={file.retry} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 pb-2">
            <Button
              onClick={() => setPlaying(true)}
              className="gap-2 bg-white/10 text-white hover:bg-white/15"
            >
              <Play className="size-4 fill-white" />
              Play {options.length > 1 ? chosen.label : ''}
            </Button>
            <QualityPicker options={options} value={quality} onChange={setQuality} />
            <CostNote option={chosen} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PreviewFrame
        attachment={attachment}
        url={file.url ?? preview.url}
        onError={file.url ? file.onLoadError : preview.onLoadError}
      />
      {!wantFull && attachment.urls.full && (
        <div className="flex items-center justify-end gap-3 px-2 pb-1">
          <CostNote option={{ variant: 'full', label: 'Source', url: null, bytes: attachment.sizeBytes ?? null }} />
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
      {wantFull && file.status === 'loading' && (
        <p className="px-2 pb-1 text-right text-xs text-zinc-400">
          {file.slow ? 'Fetching and caching full resolution…' : 'Loading full resolution…'}
        </p>
      )}
    </div>
  );
}

/**
 * The player.
 *
 * Split out so it can hold a ref and **tear itself down on unmount** — pausing
 * and clearing `src` aborts whatever the element is still fetching. Radix
 * unmounts dialog content on close, so this fires whenever the lightbox is
 * dismissed mid-stream. It matters less than it used to, now that `src` always
 * points at our own bucket rather than at the provider's metered proxy, but a
 * half-finished download of a few hundred megabytes is still worth stopping.
 */
function VideoPlayer({ src, poster }: { src: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      controls
      autoPlay
      poster={poster ?? undefined}
      className="max-h-[75vh] w-full rounded-md bg-black"
    />
  );
}

/**
 * Which rendition to play.
 *
 * Rendered as plain buttons rather than a `Select` because there are two or
 * three of them and the choice has a price attached — a control the operator has
 * to open to read is the wrong shape for that.
 */
function QualityPicker({
  options,
  value,
  onChange,
}: {
  options: QualityOption[];
  value: OFMediaVariant;
  onChange: (variant: OFMediaVariant) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {options.map((option) => (
        <Button
          key={option.variant}
          size="sm"
          variant="ghost"
          onClick={() => onChange(option.variant)}
          aria-pressed={option.variant === value}
          className={cn(
            'h-7 px-2.5 text-xs',
            option.variant === value
              ? 'bg-white/10 text-white hover:bg-white/15'
              : 'text-zinc-400 hover:text-white',
          )}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * What this download will cost, when that is knowable.
 *
 * Only shown for the source master, and only when the provider reported a size —
 * which it often does not. Saying nothing is correct in that case: a made-up
 * figure about money is worse than no figure, the same rule the tip bubble
 * follows when it renders an unparseable amount as "Tip" rather than "$0".
 */
function CostNote({ option }: { option: QualityOption }) {
  if (option.variant !== 'full' || !option.bytes) return null;
  return (
    <p className="text-xs text-zinc-400">
      Source is {formatBytes(option.bytes)} — about {estimateCredits(option.bytes).toLocaleString()}{' '}
      credits the first time it is opened, then free.
    </p>
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

function ViewerStatus({
  status,
  slow,
  onRetry,
}: {
  status: MediaStatus;
  slow?: boolean;
  onRetry: () => void;
}) {
  if (status === 'loading' || status === 'idle') {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        {slow ? 'Fetching this once and caching it — replays are instant.' : 'Loading…'}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 text-sm text-zinc-400">
      <p>
        {status === 'expired' || status === 'uncached'
          ? 'Refresh the thread to load this.'
          : 'Could not load this media.'}
      </p>
      {status === 'error' && (
        <Button size="sm" variant="ghost" onClick={onRetry} className="gap-1 text-zinc-400 hover:text-white">
          <RotateCw className="size-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
