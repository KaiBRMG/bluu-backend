/**
 * Rasterises the Bluu Rock lockup (public/logo/bluu_long.svg) into the email
 * masthead (public/email/wordmark.png): the white-inked wordmark on its own
 * rounded dark plate.
 *
 * The plate is part of the IMAGE on purpose. The email is light, and mail apps
 * in dark mode recolour backgrounds and text but never images — so a plate
 * baked in here keeps the white letters legible on a white page, an inverted
 * page, and every client in between. PNG, not SVG or WebP: Gmail drops SVG
 * and Outlook drops WebP. Built at 3x the 172x56 display size.
 *
 *   cd src && node scripts/build-email-wordmark.js
 */
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '../public/logo/bluu_long.svg');
const OUT = path.join(__dirname, '../public/email/wordmark.png');

const SCALE = 3;
const W = 172 * SCALE;
const H = 56 * SCALE;
const MARK_W = 132 * SCALE;
const RADIUS = 12 * SCALE;
const PLATE = '#08090b';

(async () => {
  const mark = await sharp(SRC, { density: 300 }).trim().resize({ width: MARK_W }).png().toBuffer();
  const { height: markH } = await sharp(mark).metadata();
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${RADIUS}" fill="${PLATE}"/></svg>`,
  );
  const info = await sharp(plate)
    .composite([{ input: mark, left: Math.round((W - MARK_W) / 2), top: Math.round((H - markH) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(OUT);
  console.log(`wrote ${OUT} (${info.width}x${info.height}, ${info.size} bytes)`);
})();
