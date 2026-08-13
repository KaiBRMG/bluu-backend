/**
 * Normalises the Prompt Library LLM logos into uniform, dark-ground-safe WebP marks.
 *
 * The supplied source PNGs are 1000x1000 and inconsistent in three ways that
 * matter on a near-black console (#09090b):
 *
 *   chatgpt / grok  — pure black marks on transparency. Invisible on the canvas.
 *                     Fix: negate RGB only (black -> white), alpha untouched.
 *   wavespeed       — white mark baked onto an OPAQUE black square, no alpha.
 *                     Fix: luminance becomes the alpha channel over flat white,
 *                     which lifts the mark out of its box cleanly.
 *   claude          — orange on transparency. Already correct; brand hue kept.
 *   higgsfield      — a full-bleed lime app tile with rounded transparent
 *                     corners. A tile, not a bare mark; kept as-is.
 *
 * Every output is then optically normalised: the visible content is trimmed to
 * its bounding box and re-padded so the mark occupies the same fraction of the
 * canvas in all five files. Without this, the tile logo reads twice the size of
 * the bare marks at identical CSS dimensions.
 *
 * Run from `src/`:  node scripts/build-prompt-library-logos.js
 * Outputs alongside the sources in `src/public/prompt-library-llm-logos/`.
 */

const path = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, '..', 'public', 'prompt-library-llm-logos');

// Output canvas, and the fraction of it the mark's bounding box should fill.
// 256 is 2x the largest rendered size (128px home tile), so the mark stays
// crisp on HiDPI without shipping a 1000px source.
const SIZE = 256;
const CONTENT_RATIO = 0.78;

/** Black-on-transparent mark -> white-on-transparent. Alpha is preserved. */
const toWhiteMark = img => img.negate({ alpha: false });

/**
 * White-on-opaque-black -> white-on-transparent. The source has no alpha, so
 * its own luminance is the mask: bright pixels become opaque, black becomes
 * fully transparent, and the black backing square disappears.
 */
async function liftFromBlackBox(img) {
  const { data, info } = await img
    .clone()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sharp({
    create: {
      width: info.width,
      height: info.height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).joinChannel(data, { raw: { width: info.width, height: info.height, channels: 1 } });
}

// `optical` is a hand-tuned nudge on top of the geometric fit. Equal bounding
// boxes are not equal apparent sizes: WaveSpeed's mark is a wide, short glyph
// that reads small, and Higgsfield's solid tile reads large. Verified on a
// contact sheet against the surface colour, not guessed.
const SOURCES = [
  { file: 'chatgpt.png', transform: toWhiteMark, optical: 1 },
  { file: 'grok.png', transform: toWhiteMark, optical: 1 },
  { file: 'wavespeed.png', transform: liftFromBlackBox, optical: 1.22 },
  { file: 'claude.png', transform: img => img, optical: 1 },
  { file: 'higgsfield.png', transform: img => img, optical: 0.92 },
];

async function build({ file, transform, optical }) {
  const src = path.join(DIR, file);
  const out = path.join(DIR, file.replace(/\.png$/, '.webp'));

  const transformed = await transform(sharp(src));

  // Trim transparency to the mark's true bounding box, so optical sizing is
  // driven by the artwork rather than by however much padding the source had.
  const trimmed = await transformed.clone().trim({ threshold: 1 }).png().toBuffer();
  const { width, height } = await sharp(trimmed).metadata();

  const box = Math.round(SIZE * CONTENT_RATIO * optical);
  const scale = Math.min(box / Math.max(width, height), SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const info = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(trimmed).resize(w, h, { fit: 'fill' }).toBuffer(),
        left: Math.round((SIZE - w) / 2),
        top: Math.round((SIZE - h) / 2),
      },
    ])
    .webp({ quality: 92, effort: 6 })
    .toFile(out);

  console.log(
    `${file.padEnd(16)} -> ${path.basename(out).padEnd(16)} ${SIZE}x${SIZE}  ${(info.size / 1024).toFixed(1)}KB`
  );
}

(async () => {
  for (const source of SOURCES) await build(source);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
