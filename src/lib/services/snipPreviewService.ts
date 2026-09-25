/**
 * The link-preview image for a shared snip — what WhatsApp, Telegram, Slack and
 * friends draw when `/s/{id}` is pasted into a chat.
 *
 * ## Why not just point `og:image` at `/image`
 *
 * `/image` 302s to the original still, which is a full-resolution PNG — a
 * Retina screenshot is routinely 2–6 MB. **WhatsApp silently drops an
 * `og:image` over roughly 600 KB**, so the preview would come out as a bare
 * link for exactly the snips people most want to share. This re-encodes the
 * still as a JPEG bounded to `PREVIEW_MAX_EDGE`, which lands well under that
 * ceiling for any screen.
 *
 * ## Why the bytes cross the function here (rule 9i)
 *
 * Rule 9i forbids routing *bulk* bytes through a function. This is not that:
 * the function reads the original from Storage (GCS egress, not Fast Origin
 * Transfer) and emits a ~100–250 KB derivative, once per unfurl — a chat
 * platform fetches it when the link is pasted and caches its own copy. A
 * stored derivative would save that encode, but it would be a third object per
 * snip that every delete path and the retention sweep has to learn about, for a
 * request that happens a handful of times in a snip's life.
 *
 * A recording's preview is its poster with a play badge, so a recipient can
 * tell at a glance that the link is a video. No chat client plays a WebM
 * inline from `og:video`, so the badge is the honest signal.
 */

import sharp from 'sharp';
import { adminStorage } from '../firebase-admin';
import { resolveLiveSnipObject } from './snipService';

/** Long edge of the preview. 1200 is the size Open Graph consumers ask for. */
const PREVIEW_MAX_EDGE = 1200;
const PREVIEW_JPEG_QUALITY = 78;
/** Same guard as the other sharp paths: refuse decompression bombs. */
const LIMIT_INPUT_PIXELS = 100_000_000;

/**
 * The preview JPEG for a live snip, or null for every refusal (unknown,
 * deleted, pending, expired, or a recording with no poster) — the caller turns
 * that into the same single 404 as the other public routes.
 */
export async function renderSnipPreview(id: string): Promise<Buffer | null> {
  // The still: the capture for an image snip, the poster for a recording.
  const still = await resolveLiveSnipObject(id, 'still');
  if (!still) return null;
  const isVideo = still.kind === 'video';

  const [original] = await adminStorage.bucket().file(still.path).download();

  // `animated: false` — an imported GIF previews as its first frame.
  const base = sharp(original, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
    .rotate()
    .resize({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Transparent regions of a PNG would otherwise turn black in the JPEG.
    .flatten({ background: '#0a0a0a' });

  if (!isVideo) {
    return base.jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }

  // The badge has to be sized off the *resized* frame, so resolve it first.
  const { data, info } = await base.toBuffer({ resolveWithObject: true });
  // A frame smaller than the badge would make `composite` throw.
  if (Math.min(info.width, info.height) < 64) {
    return sharp(data).jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }
  return sharp(data)
    .composite([{ input: playBadge(info.width, info.height), gravity: 'centre' }])
    .jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** A centred play button, ~18% of the short edge — legible in a chat bubble
 *  thumbnail without covering the frame it sits on. */
function playBadge(width: number, height: number): Buffer {
  const d = Math.max(48, Math.round(Math.min(width, height) * 0.18));
  const r = d / 2;
  // Triangle nudged right of centre so it reads as optically centred.
  const t = d * 0.2;
  const cx = r + d * 0.04;
  // Inset by half the stroke so the ring is not clipped by the SVG's own box.
  const stroke = Math.max(2, d * 0.03);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">
  <circle cx="${r}" cy="${r}" r="${r - stroke / 2 - 1}" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.85)" stroke-width="${stroke}"/>
  <path d="M ${cx - t * 0.8} ${r - t} L ${cx + t} ${r} L ${cx - t * 0.8} ${r + t} Z" fill="#ffffff"/>
</svg>`;
  return Buffer.from(svg);
}
