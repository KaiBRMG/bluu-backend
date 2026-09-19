'use client';

import { useState } from 'react';

/**
 * The shared screenshot itself.
 *
 * **A plain `<img>`, and it has to be.** DESIGN.md's "never a raw `<img>`" rule
 * is about people (avatars) and about the app's own chrome; this is neither, and
 * the two alternatives are both wrong here. `Avatar` crops to a circle. And
 * `next/image` would pull every view through Vercel's image optimizer — the
 * exact "bulk bytes through a function" that rule 9i exists to prevent, on a
 * public page whose traffic we do not control. `src` is a 302 to Cloud Storage,
 * so the picture travels bucket → recipient and touches nothing of ours.
 *
 * The intrinsic `width`/`height` are the capture's real pixel dimensions, so the
 * box reserves its correct shape before a single byte lands and the attribution
 * line below never jumps. They come off the row, not off the file.
 */
export function SnipImage({
  src,
  width,
  height,
  alt,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // One quiet line, no box of its own — DESIGN.md §5. The likeliest cause is
    // the snip being deleted between the page rendering and the image loading,
    // and "it is gone" is the whole of what a recipient can act on.
    return (
      <p className="text-sm text-zinc-400">
        This screenshot is no longer available.
      </p>
    );
  }

  // Deliberately NOT wrapped in a link. It used to be an `<a href={src}>`
  // "open full size", but `src` is a 302 to a signed Storage URL — following it
  // put `storage.googleapis.com/.../snips/<owner uid>/...` in the visitor's
  // address bar, handing a stranger the owner's uid and a one-hour bearer URL
  // that outlives deleting the snip. `getPublicSnip` goes to some length to keep
  // uids off this page; a link that leaks one undoes that.
  //
  // Nothing is lost: the image already renders at the full width of the page,
  // which is the widest this layout has to offer.
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        // A capture with no recorded dimensions still renders; the attributes are
        // simply omitted rather than being given a guess that would reserve the
        // wrong shape.
        width={width > 0 ? width : undefined}
        height={height > 0 ? height : undefined}
        onError={() => setFailed(true)}
        className="h-auto w-full"
      />
    </div>
  );
}
