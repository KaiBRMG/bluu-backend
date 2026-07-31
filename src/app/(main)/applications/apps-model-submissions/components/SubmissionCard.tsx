'use client';

import { useRef, useState } from 'react';
import { IconCheck, IconChevronLeft, IconChevronRight, IconPhotoOff, IconX } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SUBMISSION_STATUS_META } from '@/lib/modelSubmissions';
import { cn } from '@/lib/utils';
import type { ModelSubmissionSummary, SubmissionStatus } from '@/types/modelSubmission';

interface SubmissionCardProps {
  submission: ModelSubmissionSummary;
  onOpen: () => void;
  onSetStatus: (status: SubmissionStatus) => void;
}

/**
 * One applicant in the queue.
 *
 * The photo strip pages in place, so the common decision — "do the photos work,
 * yes or no" — never needs the detail view. Opening the record is for the
 * cases where the photos alone don't settle it.
 */
export function SubmissionCard({ submission, onOpen, onSetStatus }: SubmissionCardProps) {
  const [index, setIndex] = useState(0);
  const photos = submission.thumbs;
  const meta = SUBMISSION_STATUS_META[submission.status];
  const current = photos[Math.min(index, photos.length - 1)];

  // Warm the neighbours once the reviewer starts paging. Mounting every thumb
  // up front would pull ~12 files per card the moment it scrolled into view;
  // fetching only what they're about to reach keeps the first paint cheap and
  // still means the next tap is instant rather than a visible load.
  const warmed = useRef(new Set<string>());
  const prefetch = (i: number) => {
    const url = photos[(i + photos.length) % photos.length]?.thumbUrl;
    if (!url || warmed.current.has(url)) return;
    warmed.current.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  };

  const step = (delta: number) => {
    setIndex((i) => {
      const next = (i + delta + photos.length) % photos.length;
      prefetch(next + 1);
      prefetch(next - 1);
      return next;
    });
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-white/[0.07] bg-white/[0.025] py-0">
      {/*
        ── Photo strip ───────────────────────────────────────────────
        A FIXED 9:16 frame — phone-portrait, matching how these photos are almost
        always shot. Two things make it hold its size no matter what the
        applicant uploaded:

        1. `aspect-[9/16]` sets the height from the column width — but on its own
           that is only a *preferred* size. An aspect-ratio box does not clamp
           its content, so a tall in-flow image still stretches it, and the card
           grows and shrinks as the reviewer pages through photos.
        2. Everything inside is therefore `absolute inset-0` — out of flow, so
           it cannot contribute height at all — and `object-cover` crops the
           overflow. Anything wider than 9:16 loses its sides here; the full,
           uncropped image is one click away in the detail viewer.

        The frame is also what guarantees no layout shift, which is why the
        images carry no intrinsic `width`/`height`: those attributes fed the
        min-content contribution that was resizing the card in the first place.
      */}
      <div className="relative aspect-[9/16] overflow-hidden bg-black/40">
        {current ? (
          <button
            type="button"
            onClick={onOpen}
            className="absolute inset-0 block cursor-zoom-in"
            aria-label={`Open ${submission.name}'s full submission`}
          >
            {/* No `key` on the src: keying by URL remounts the element on every
                step, which blanks the frame before the next image paints even
                when it is already cached. Swapping `src` on a live element lets
                a cached image appear in the same frame. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.thumbUrl}
              alt={`${submission.name}, photo ${index + 1} of ${photos.length}`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600">
            <IconPhotoOff className="size-6" />
            <span className="text-xs">No photos</span>
          </div>
        )}

        <span
          className={cn(
            'absolute top-2 left-2 rounded-full border px-2 py-0.5 text-xs font-medium backdrop-blur-sm',
            meta.classes,
          )}
        >
          {meta.label}
        </span>

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous photo"
              className="absolute top-1/2 left-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
            >
              <IconChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next photo"
              className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
            >
              <IconChevronRight className="size-4" />
            </button>
            <div
              className="absolute inset-x-0 bottom-2 flex justify-center gap-1"
              aria-hidden
            >
              {photos.map((photo, i) => (
                <span
                  key={photo.thumbUrl}
                  className={cn(
                    'h-1 rounded-full transition-all duration-200',
                    i === index ? 'w-4 bg-white' : 'w-1 bg-white/40',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Identity ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 p-3">
        <button type="button" onClick={onOpen} className="text-left">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{submission.name}</span>
            <span className="text-sm text-zinc-400 tabular-nums">{submission.age}</span>
          </div>
          <div className="truncate text-xs text-zinc-400">
            {submission.city}, {submission.country}
          </div>
        </button>

        <div className="flex items-center gap-1.5">
          {submission.hasOnlyFans && (
            <Badge variant="secondary" className="text-xs">
              Has OF
            </Badge>
          )}
          <span className="ml-auto text-xs text-zinc-500 tabular-nums">
            {submission.photoCount} photo{submission.photoCount === 1 ? '' : 's'}
          </span>
        </div>

        {/* ── Decision ──────────────────────────────────────────────────
            Pinned to the button height in both states, so a reviewed card is
            exactly as tall as an unreviewed one and the grid rows stay level
            as decisions are made. */}
        <div className="flex h-8 items-center">
        {submission.status === 'new' ? (
          <div className="grid w-full grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetStatus('rejected')}
              className="h-8 border-red-500/30 bg-red-500/5 text-xs text-red-400 hover:bg-red-500/15 hover:text-red-300"
            >
              <IconX className="size-3.5" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onSetStatus('approved')}
              className="h-8 bg-green-600 text-xs text-white hover:bg-green-500"
            >
              <IconCheck className="size-3.5" />
              Approve
            </Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="truncate text-xs text-zinc-500">
              {submission.reviewedByName ? `by ${submission.reviewedByName}` : 'Reviewed'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSetStatus('new')}
              className="h-7 shrink-0 px-2 text-xs text-zinc-400 hover:text-white"
            >
              Undo
            </Button>
          </div>
        )}
        </div>
      </div>
    </Card>
  );
}
