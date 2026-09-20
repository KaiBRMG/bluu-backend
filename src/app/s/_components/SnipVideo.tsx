'use client';

import { useState } from 'react';

/**
 * The shared recording itself.
 *
 * A plain `<video>`, for the same reason [`SnipImage`](./SnipImage.tsx) is a
 * plain `<img>`: `src` is a 302 to Cloud Storage, so the megabytes travel
 * bucket → recipient and touch nothing of ours (rule 9i). There is no
 * `next/video`, and routing this through any function of ours would be the
 * worst version of the thing that rule exists to prevent — a recording is tens
 * of megabytes where a screenshot is one.
 *
 * ## The controls are the browser's
 *
 * No custom player. A recipient of a link opens it once, watches it, and
 * closes the tab; what they need is play, scrub, volume and fullscreen, which
 * they already know how to use and which work with their keyboard and their
 * screen reader without us reimplementing any of it. A bespoke player would be
 * a week of accessibility work to arrive back where the UA sheet starts.
 *
 * `preload="metadata"` rather than `auto`: the poster already shows what the
 * recording is, so fetching the whole file for a visitor who may not press
 * play is bytes nobody asked for. Metadata alone gives the scrub bar its
 * length.
 *
 * **Not autoplaying**, and not muted to make autoplay legal. A recording can
 * carry the sender's system audio, and a link that starts making noise the
 * moment it opens is a link people stop opening at their desks.
 */
export function SnipVideo({
  src,
  poster,
  width,
  height,
}: {
  src: string;
  /** The poster frame, or null when its upload failed. */
  poster: string | null;
  width: number;
  height: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // One quiet line, no box of its own — DESIGN.md §5. The likeliest cause is
    // the snip being deleted between the page rendering and the media loading,
    // and "it is gone" is the whole of what a recipient can act on.
    return <p className="text-sm text-zinc-400">This recording is no longer available.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black">
      <video
        src={src}
        poster={poster ?? undefined}
        controls
        preload="metadata"
        playsInline
        // The recording's real pixel dimensions, so the box reserves its
        // correct shape before a byte lands and the attribution line below
        // never jumps. They come off the row, not off the file.
        width={width > 0 ? width : undefined}
        height={height > 0 ? height : undefined}
        onError={() => setFailed(true)}
        className="h-auto w-full"
      >
        {/* Reached only by a browser with no WebM decoder at all. Saying so is
            better than an empty black box, and the link is still good — it can
            be opened somewhere else. */}
        Your browser cannot play this recording.
      </video>
    </div>
  );
}
