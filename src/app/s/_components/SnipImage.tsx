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

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] transition-colors hover:border-white/[0.12] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      title="Open full size"
    >
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
    </a>
  );
}
