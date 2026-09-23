import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPublicSnip } from '@/lib/services/snipService';
import { formatSnipDuration } from '@/lib/snips';
import { SnipImage } from '../_components/SnipImage';
import { SnipTimestamp } from '../_components/SnipTimestamp';
import { SnipVideo } from '../_components/SnipVideo';

/**
 * The public read-only view of a shared snip.
 *
 * A server component that calls the service directly rather than fetching its
 * own API route — there is no second consumer, and a public HTTP endpoint
 * returning snips is one more thing to rate limit. The token in the path is the
 * access control; everything a visitor can ever see is what `getPublicSnip`
 * chooses to project (no uid, no email, no storage path, no retention).
 *
 * Rendered fresh on every request — a snip that was deleted, or that has passed
 * its auto-delete date, must stop resolving immediately rather than after a
 * cache TTL. That needs no route-segment config: this project runs with Cache
 * Components, where a segment is uncached unless it opts in with `"use cache"`.
 * Do not add one here (`export const dynamic` is rejected outright under that
 * flag), and do not mark this page or `getPublicSnip` cacheable.
 *
 * The split below is required by that same flag, not stylistic: uncached data
 * must be read INSIDE a `<Suspense>` boundary, so the shell renders immediately
 * and only the snip streams in. Both `params` and the Firestore read therefore
 * live in `SharedSnipContent`, never in the default export.
 */
export default function SharedSnipPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-8">
      <Suspense fallback={<SharedSnipSkeleton />}>
        <SharedSnipContent params={params} />
      </Suspense>

      <footer className="mt-auto pt-4 text-xs text-zinc-400">
        Shared from Bluu Rock MGMT.
      </footer>
    </main>
  );
}

async function SharedSnipContent({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const snip = await getPublicSnip(shareId);

  // One 404 for every refusal — unknown token, deleted snip, expired snip, an
  // upload that never completed. Distinguishing them would tell a stranger
  // which tokens once existed.
  if (!snip) notFound();

  const isVideo = snip.kind === 'video';

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* The business lockup, at its intrinsic ratio so the header does not
            shift as the raster decodes. A plain <img> rather than next/image is
            the standing exception for the logo on a public page (DESIGN.md §5). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo/HQ2.webp"
          alt="Bluu Rock"
          width={1374}
          height={868}
          className="h-10 w-auto"
        />

        {/* "Anyone with this link", not just "read only". The token in the URL
            IS the access control — there is no sign-in and no membership check
            — so "read only" alone described the recipient's *capability* while
            implying a restriction on *who* that does not exist. A person
            deciding whether to forward this needs the true answer. */}
        <span className="rounded-full border border-white/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
          Anyone with this link · read only
        </span>
      </div>

      {/* The page had no heading at all: its only title was the <title> tag and
          a pill, so a screen reader landing on a forwarded link got no outline
          (WCAG 2.4.6, 1.3.1). Visually hidden because the capture itself is the
          page's visible title — a heading drawn above it would compete with the
          thing the recipient came to look at. */}
      {/* The owner's own title becomes the page's heading when there is one —
          which is the whole reason for letting them write one. It is drawn
          rather than `sr-only` in that case: a caption the sender chose is not
          competing with the capture, it is telling the recipient what they are
          looking at, and it saves the covering message that would otherwise
          have to travel beside the link. With no title the heading stays
          visually hidden and the capture is the page's visible title, as
          before — a generated "Shared recording" drawn above every snip would
          be chrome that says nothing. */}
      {snip.title ? (
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-white">{snip.title}</h1>
          {snip.description && (
            // `whitespace-pre-line`, because a description is allowed to be a
            // paragraph and the newlines the sender typed are the only
            // structure it has. Capped at a readable measure rather than
            // running the full width of a 5xl page.
            <p className="max-w-[70ch] whitespace-pre-line text-sm text-zinc-400">
              {snip.description}
            </p>
          )}
        </div>
      ) : (
        <>
          <h1 className="sr-only">
            Shared {isVideo ? 'recording' : 'screenshot'}
            {snip.sharedBy ? ` from ${snip.sharedBy}` : ''}
          </h1>
          {snip.description && (
            <p className="max-w-[70ch] whitespace-pre-line text-sm text-zinc-400">
              {snip.description}
            </p>
          )}
        </>
      )}

      {/* The capture is the page. Everything else is a caption for it, which is
          why the attribution sits below rather than competing above. */}
      {isVideo ? (
        <SnipVideo
          src={snip.mediaUrl}
          poster={snip.imageUrl}
          width={snip.width}
          height={snip.height}
          // The recorder's own wall clock. A `MediaRecorder` WebM states no
          // duration in its container, so without this the player has nothing
          // to draw a timeline against — see `SnipVideo`.
          durationMs={snip.durationMs}
        />
      ) : (
        <SnipImage
          src={snip.mediaUrl}
          width={snip.width}
          height={snip.height}
          // The sender's own title is a far better description of the picture
          // than anything generated from who shared it, so it is preferred when
          // there is one.
          alt={
            snip.title ||
            (snip.sharedBy ? `Screenshot shared by ${snip.sharedBy}` : 'Shared screenshot')
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
        {snip.sharedBy && (
          <>
            <span className="text-zinc-300">Shared by {snip.sharedBy}</span>
            <span aria-hidden>·</span>
          </>
        )}
        {/* Date AND time, in the VIEWER's timezone — resolved in their browser,
            because a public link has no account to read a zone from. Client
            component by necessity: the server has no idea where the visitor is.
            See `SnipTimestamp` for why it renders UTC first. */}
        <SnipTimestamp iso={snip.createdAt} />
        {isVideo && snip.durationMs != null && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatSnipDuration(snip.durationMs)}</span>
          </>
        )}
        {snip.width > 0 && snip.height > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {snip.width} × {snip.height}
            </span>
          </>
        )}
      </div>
    </>
  );
}

/** Holds the page's shape while the snip streams in, so the footer does not
 *  jump once it arrives. */
function SharedSnipSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex items-start justify-between gap-4">
        <div className="h-10 w-16 rounded-md bg-white/[0.06]" />
        <div className="h-5 w-44 rounded-full bg-white/[0.04]" />
      </div>
      <div className="aspect-[16/10] w-full rounded-xl border border-white/[0.07] bg-white/[0.025]" />
      <div className="h-3 w-56 rounded-md bg-white/[0.04]" />
    </div>
  );
}
