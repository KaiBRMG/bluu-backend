'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconBrandInstagram,
  IconBrandReddit,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandX,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconMail,
  IconX,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { SUBMISSION_STATUS_META } from '@/lib/modelSubmissions';
import { cn } from '@/lib/utils';
import type {
  ModelSubmissionDetail,
  SubmissionPhotoUrls,
  SubmissionStatus,
} from '@/types/modelSubmission';

interface SubmissionDetailProps {
  detail: ModelSubmissionDetail | null;
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetStatus: (status: SubmissionStatus) => void;
}

type Labelled = SubmissionPhotoUrls & { label: string };

/**
 * Copies one handle or link to the clipboard.
 *
 * Reviewers move these into Telegram, a CRM, or a message to the applicant, and
 * selecting a handle out of a dialog by hand is fiddly and easy to get wrong
 * (an off-by-one on a username is a message sent to a stranger). The icon
 * confirms in place for a moment rather than only firing a toast, so the
 * feedback is where the eye already is.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access');
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      className="size-6 shrink-0 text-zinc-500 hover:bg-white/[0.06] hover:text-white"
    >
      {copied ? (
        <IconCheck className="size-3.5 text-green-400" />
      ) : (
        <IconCopy className="size-3.5" />
      )}
    </Button>
  );
}

/**
 * A labelled row of applicant detail. Empty values are dropped by the caller.
 * Pass `copy` to put a copy control at the end of the row.
 */
function Detail({
  label,
  copy,
  copyLabel,
  children,
}: {
  label: string;
  copy?: string;
  copyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="flex items-start gap-1 text-sm break-words">
        <span className="min-w-0 flex-1 break-words">{children}</span>
        {copy && <CopyButton value={copy} label={copyLabel ?? label} />}
      </dd>
    </div>
  );
}

/** `https://www.instagram.com/bluurock` → `instagram.com/bluurock`. */
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[#3b82f6] underline-offset-2 hover:text-white hover:underline"
    >
      {children}
      <IconExternalLink className="size-3" />
    </a>
  );
}

/**
 * The full record: every answer, and every photo at full size.
 *
 * The viewer is the point of this screen, so it takes the left two-thirds and
 * the answers sit beside it. Only the photo currently being looked at is
 * fetched at full size — the rail underneath stays on lazily-loaded WebP
 * thumbnails, so opening a record costs one large image, not thirteen.
 */
export function SubmissionDetail({
  detail,
  loading,
  open,
  onOpenChange,
  onSetStatus,
}: SubmissionDetailProps) {
  const [index, setIndex] = useState(0);

  const photos = useMemo<Labelled[]>(() => {
    if (!detail) return [];
    return [
      ...detail.selfies.map((p) => ({ ...p, label: 'Selfie' })),
      ...detail.bodyPhotos.map((p) => ({ ...p, label: 'Body' })),
      ...detail.earningsPhotos.map((p) => ({ ...p, label: 'Earnings' })),
    ];
  }, [detail]);

  // Reset the viewer when a different record loads. Adjusted during render (the
  // React-sanctioned pattern) rather than in an effect, which would paint the
  // previous applicant's photo for one frame.
  const [indexOwner, setIndexOwner] = useState<string | null>(null);
  if (detail && detail.id !== indexOwner) {
    setIndexOwner(detail.id);
    setIndex(0);
  }

  // Warm the neighbours around whatever is on screen. These are the full-size
  // renders, so a cold arrow-key press is the most visible stall on the page —
  // and a reviewer paging a set of photos almost always continues in the same
  // direction. Runs after the current image is requested, never before it.
  const warmed = useRef(new Set<string>());
  useEffect(() => {
    if (photos.length < 2) return;
    const neighbours = [
      photos[(index + 1) % photos.length],
      photos[(index - 1 + photos.length) % photos.length],
    ];
    const timer = window.setTimeout(() => {
      for (const photo of neighbours) {
        if (!photo || warmed.current.has(photo.url)) continue;
        warmed.current.add(photo.url);
        const img = new Image();
        img.decoding = 'async';
        img.src = photo.url;
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [index, photos]);

  const step = useCallback(
    (delta: number) => {
      if (photos.length === 0) return;
      setIndex((i) => (i + delta + photos.length) % photos.length);
    },
    [photos.length],
  );

  // Arrow keys page the viewer — the fastest path through a queue of photos.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const current = photos[index];
  const meta = detail ? SUBMISSION_STATUS_META[detail.status] : null;

  // The per-platform pages that were actually filled in. Stored as full URLs,
  // so nothing is reconstructed here — a row is a link or it does not exist.
  const socialRows = useMemo(
    () =>
      (
        [
          { key: 'instagram', Icon: IconBrandInstagram, url: detail?.socialInstagram },
          { key: 'twitter', Icon: IconBrandX, url: detail?.socialTwitter },
          { key: 'reddit', Icon: IconBrandReddit, url: detail?.socialReddit },
        ] as const
      ).filter((row): row is typeof row & { url: string } => !!row.url),
    [detail],
  );

  // Applicants rarely type the scheme. Resolved once so the anchor and the copy
  // button can never disagree about where the link points.
  const trialHref = detail?.trialLink
    ? /^https?:\/\//i.test(detail.trialLink)
      ? detail.trialLink
      : `https://${detail.trialLink}`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 truncate text-base">
              {loading || !detail ? <Skeleton className="h-5 w-40" /> : detail.name}
              {meta && (
                <span
                  className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', meta.classes)}
                >
                  {meta.label}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {detail
                ? `${detail.age} · ${detail.city}, ${detail.country} · applied ${new Date(
                    detail.createdAt,
                  ).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}`
                : 'Loading submission'}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="text-zinc-400 hover:text-white"
          >
            <IconX className="size-4" />
          </Button>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] lg:overflow-hidden">
          {/* ── Viewer ────────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-2 bg-black/40 p-3">
            <div className="relative flex min-h-[46vh] flex-1 items-center justify-center overflow-hidden rounded-lg lg:min-h-0">
              {loading ? (
                <Skeleton className="size-full rounded-lg" />
              ) : current ? (
                <>
                  {/* No `key` on the src — see SubmissionCard: keying by URL
                      remounts the element and blanks the frame even when the
                      next image is already cached.
                      eslint-disable-next-line @next/next/no-img-element */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={current.url}
                    alt={`${detail?.name ?? 'Applicant'} — ${current.label.toLowerCase()} ${index + 1} of ${photos.length}`}
                    width={current.width}
                    height={current.height}
                    className="max-h-full w-auto max-w-full object-contain"
                  />
                  <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium text-zinc-200">
                    {current.label} · {index + 1}/{photos.length}
                  </span>
                  {photos.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => step(-1)}
                        aria-label="Previous photo"
                        className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-black/85 hover:text-white"
                      >
                        <IconChevronLeft className="size-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => step(1)}
                        aria-label="Next photo"
                        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-black/85 hover:text-white"
                      >
                        <IconChevronRight className="size-5" />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-400">No photos on this submission.</p>
              )}
            </div>

            {photos.length > 1 && (
              <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
                {photos.map((photo, i) => (
                  <button
                    key={photo.thumbUrl}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`View ${photo.label.toLowerCase()} ${i + 1}`}
                    aria-current={i === index}
                    className={cn(
                      'size-14 shrink-0 overflow-hidden rounded-md border transition-all',
                      i === index
                        ? 'border-[#3b82f6] opacity-100'
                        : 'border-white/[0.07] opacity-55 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Answers ───────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading || !detail ? (
                <div className="flex flex-col gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  ))}
                </div>
              ) : (
                <dl className="flex flex-col gap-4">
                  <Detail label="Email" copy={detail.email} copyLabel="Email address">
                    <ExternalLink href={`mailto:${detail.email}`}>
                      <IconMail className="size-3.5" />
                      {detail.email}
                    </ExternalLink>
                  </Detail>

                  {detail.telegram && (
                    <Detail
                      label="Telegram"
                      // The full URL, not the bare handle: it pastes straight
                      // into a browser or a message and stays clickable.
                      copy={`https://t.me/${detail.telegram}`}
                      copyLabel="Telegram link"
                    >
                      <ExternalLink href={`https://t.me/${detail.telegram}`}>
                        <IconBrandTelegram className="size-3.5" />@{detail.telegram}
                      </ExternalLink>
                    </Detail>
                  )}

                  {detail.whatsapp && (
                    <Detail label="WhatsApp" copy={detail.whatsapp} copyLabel="WhatsApp number">
                      {/* wa.me takes the number without its `+`. Stored E.164,
                          so the link and the copied value never disagree. */}
                      <ExternalLink href={`https://wa.me/${detail.whatsapp.replace(/\D/g, '')}`}>
                        <IconBrandWhatsapp className="size-3.5" />
                        {detail.whatsapp}
                      </ExternalLink>
                    </Detail>
                  )}

                  {/* Legacy: Instagram was a contact field before the social
                      section existed. Only older records still carry it. */}
                  {detail.instagram && (
                    <Detail
                      label="Instagram"
                      copy={`https://instagram.com/${detail.instagram}`}
                      copyLabel="Instagram link"
                    >
                      <ExternalLink href={`https://instagram.com/${detail.instagram}`}>
                        <IconBrandInstagram className="size-3.5" />@{detail.instagram}
                      </ExternalLink>
                    </Detail>
                  )}

                  <Separator className="bg-white/[0.07]" />

                  <div className="grid grid-cols-2 gap-4">
                    <Detail label="Age">
                      <span className="tabular-nums">{detail.age}</span>
                    </Detail>
                    <Detail label="Sexuality">
                      <span className="capitalize">{detail.sexuality}</span>
                    </Detail>
                    <Detail label="Location">
                      {detail.city}, {detail.country}
                    </Detail>
                    <Detail label="Existing OnlyFans">
                      {detail.hasOnlyFans ? (
                        <Badge variant="secondary" className="text-xs">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-zinc-400">No</span>
                      )}
                    </Detail>
                  </div>

                  <Separator className="bg-white/[0.07]" />

                  {/* Social pages. Stored as full profile URLs, one field per
                      platform, so each row is a link the reviewer can open —
                      while the row's copy button still hands over the whole set
                      as one block, which is what gets pasted elsewhere. */}
                  <Detail
                    label="Social media"
                    copy={detail.socialLinks || undefined}
                    copyLabel="Social links"
                  >
                    {detail.socialLinks ? (
                      <span className="flex flex-col items-start gap-2">
                        {socialRows.map(({ key, Icon, url }) => (
                          <ExternalLink key={key} href={url}>
                            <Icon className="size-3.5 shrink-0" />
                            <span className="break-all">{prettyUrl(url)}</span>
                          </ExternalLink>
                        ))}
                        {/* `socialOther` is free text, and a record predating
                            the per-platform fields keeps everything in the
                            joined block — both render as plain lines. */}
                        {(detail.socialOther || socialRows.length === 0) && (
                          <span className="whitespace-pre-line">
                            {detail.socialOther || detail.socialLinks}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-zinc-400">Not given</span>
                    )}
                  </Detail>

                  {detail.hasOnlyFans && (
                    <>
                      <Separator className="bg-white/[0.07]" />
                      <Detail
                        label="Free trial link"
                        copy={trialHref || undefined}
                        copyLabel="Trial link"
                      >
                        {trialHref ? (
                          <ExternalLink href={trialHref}>{detail.trialLink}</ExternalLink>
                        ) : (
                          <span className="text-zinc-400">Not given</span>
                        )}
                      </Detail>
                    </>
                  )}

                  {detail.reviewedByName && (
                    <>
                      <Separator className="bg-white/[0.07]" />
                      <Detail label="Reviewed by">
                        {detail.reviewedByName}
                        {detail.reviewedAt &&
                          ` · ${new Date(detail.reviewedAt).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                          })}`}
                      </Detail>
                    </>
                  )}
                </dl>
              )}
            </div>

            {/* ── Decision ────────────────────────────────────────────── */}
            {detail && (
              <div className="shrink-0 border-t border-white/[0.07] p-3">
                {detail.status === 'new' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onSetStatus('rejected')}
                      className="border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:text-red-300"
                    >
                      <IconX className="size-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => onSetStatus('approved')}
                      className="bg-green-600 text-white hover:bg-green-500"
                    >
                      <IconCheck className="size-4" />
                      Approve
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onSetStatus('new')}
                  >
                    Move back to new
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
